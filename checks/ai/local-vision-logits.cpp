// llama.cpp's side of checks/ai/local-vision-check.js: for each prompt with an image, mtmd's image embeddings, the logits
// at every text position of the prompt and over greedy decode steps, from llama.cpp and mtmd on the CPU only. Not part of
// the suite. Numerics kept plain as in local-reference-logits.cpp: CPU backend only, f32 K and V cache, flash attention
// off (in the text model and in clip, whose flash path casts K and V to f16), no op offload, no weight repacking. Run it
// on F32-expanded GGUFs so neither side quantizes activations, and for the exact comparison with ggml_conv_2d's im2col
// made F32 for an F32 kernel (stock v0.8.0 ggml.c: `a->type == GGML_TYPE_BF16 ? GGML_TYPE_F32 : GGML_TYPE_F16`, which
// rounds every pixel to f16 before the patchifier; add `|| a->type == GGML_TYPE_F32` and rebuild ggml-base).
//   g++ -std=c++17 -O2 checks/ai/local-vision-logits.cpp -I<src>/include -I<src>/ggml/include -I<src>/tools/mtmd \
//     -L<src>/build/bin -lmtmd -lllama -lggml -lggml-base -Wl,-rpath,<src>/build/bin -o llama-vision
//   llama-vision <model.gguf> <mmproj.gguf> <prompts.tsv> <image dir> <out dir> <decode steps> <threads>
// prompts.tsv: `id<TAB>image file<TAB>text`, \n, \t and \\ escaped, the text holding mtmd's marker <__media__> once and
// its special tokens parsed. An image file is raw RGBA named <name>-<width>x<height>.rgba; alpha is dropped, as
// stb_image does when asked for 3 channels.
// Writes <id>.json { id, vocab, embd, chunks: [{ text: [ids] } | { image: n tokens }], gen }, <id>.embd.f32 (the image's
// n tokens × embd floats), <id>.prefill.f32 (one row of vocab floats per text token of the prompt, in order: row i predicts
// what follows that token) and <id>.decode.f32 (decode row s, after feeding gen[s], gives gen[s + 1]).
#include "ggml-backend.h"
#include "llama.h"
#include "mtmd.h"
#include "mtmd-helper.h"

#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <sstream>
#include <string>
#include <vector>

static std::string unescape(const std::string & s) {
    std::string o;
    for (size_t i = 0; i < s.size(); i++) {
        if (s[i] == '\\' && i + 1 < s.size()) {
            char c = s[++i];
            o += c == 'n' ? '\n' : c == 't' ? '\t' : c;
        } else {
            o += s[i];
        }
    }
    return o;
}

static void log_filter(ggml_log_level level, const char * text, void *) {
    if (level >= GGML_LOG_LEVEL_WARN || strstr(text, "buffer size") || strstr(text, "device") || strstr(text, "encoded in") || strstr(text, "projector")) fputs(text, stderr);
}

static int argmax(const float * v, int n) {
    int b = 0;
    for (int i = 1; i < n; i++) if (v[i] > v[b]) b = i;
    return b;
}

static double now_ms() {
    return std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now().time_since_epoch()).count();
}

int main(int argc, char ** argv) {
    if (argc != 8) {
        fprintf(stderr, "usage: %s model.gguf mmproj.gguf prompts.tsv image-dir out-dir decode-steps threads\n", argv[0]);
        return 2;
    }
    const std::string img_dir = argv[4], out_dir = argv[5];
    const int steps = atoi(argv[6]);
    const int threads = atoi(argv[7]);

    llama_log_set(log_filter, nullptr);
    mtmd_helper_log_set(log_filter, nullptr);
    llama_backend_init();
    for (size_t i = 0; i < ggml_backend_dev_count(); i++) {
        ggml_backend_dev_t d = ggml_backend_dev_get(i);
        fprintf(stderr, "device %zu: %s (%s)\n", i, ggml_backend_dev_name(d), ggml_backend_dev_description(d));
        if (ggml_backend_dev_type(d) != GGML_BACKEND_DEVICE_TYPE_CPU) { fprintf(stderr, "a device other than the CPU is loaded\n"); return 1; }
    }

    llama_model_params mp = llama_model_default_params();
    mp.n_gpu_layers = 0;
    mp.use_extra_bufts = false;
    llama_model * model = llama_model_load_from_file(argv[1], mp);
    if (!model) { fprintf(stderr, "cannot load model\n"); return 1; }
    const llama_vocab * vocab = llama_model_get_vocab(model);
    const int n_vocab = llama_vocab_n_tokens(vocab);
    const int n_embd = llama_model_n_embd_inp(model);

    mtmd_context_params vp = mtmd_context_params_default();
    vp.use_gpu = false;
    vp.n_threads = threads;
    vp.flash_attn_type = LLAMA_FLASH_ATTN_TYPE_DISABLED;
    vp.warmup = false;
    vp.print_timings = true;
    mtmd_context * mctx = mtmd_init_from_file(argv[2], model, vp);
    if (!mctx) { fprintf(stderr, "cannot load mmproj\n"); return 1; }
    if (mtmd_decode_use_mrope(mctx)) { fprintf(stderr, "M-RoPE text positions: not what this harness writes\n"); return 1; }

    std::ifstream in(argv[3]);
    std::string line;
    while (std::getline(in, line)) {
        if (line.empty()) continue;
        const size_t a = line.find('\t'), b = line.find('\t', a + 1);
        const std::string id = line.substr(0, a), file = line.substr(a + 1, b - a - 1);
        const std::string text = unescape(line.substr(b + 1));

        // <name>-<w>x<h>.rgba
        const size_t dash = file.rfind('-'), x = file.rfind('x'), dot = file.rfind('.');
        const int w = atoi(file.substr(dash + 1, x - dash - 1).c_str()), h = atoi(file.substr(x + 1, dot - x - 1).c_str());
        std::ifstream fi(img_dir + "/" + file, std::ios::binary);
        std::vector<unsigned char> rgba((std::istreambuf_iterator<char>(fi)), std::istreambuf_iterator<char>());
        if (w <= 0 || h <= 0 || rgba.size() != (size_t) w * h * 4) { fprintf(stderr, "%s: %s is not %dx%d RGBA\n", id.c_str(), file.c_str(), w, h); return 1; }
        std::vector<unsigned char> rgb((size_t) w * h * 3);
        for (size_t p = 0; p < (size_t) w * h; p++) for (int c = 0; c < 3; c++) rgb[p * 3 + c] = rgba[p * 4 + c];
        mtmd_bitmap * bmp = mtmd_bitmap_init(w, h, rgb.data());

        mtmd_input_chunks * chunks = mtmd_input_chunks_init();
        mtmd_input_text it = { text.c_str(), text.size(), false, true };
        const mtmd_bitmap * bmps[1] = { bmp };
        if (mtmd_tokenize(mctx, chunks, &it, bmps, 1)) { fprintf(stderr, "%s: tokenize failed\n", id.c_str()); return 1; }
        const size_t n_chunks = mtmd_input_chunks_size(chunks);
        size_t n_total = 0;
        for (size_t c = 0; c < n_chunks; c++) n_total += mtmd_input_chunk_get_n_tokens(mtmd_input_chunks_get(chunks, c));

        llama_context_params cp = llama_context_default_params();
        cp.n_ctx = n_total + steps + 16;
        cp.n_batch = cp.n_ubatch = n_total;
        cp.n_seq_max = 1;
        cp.n_threads = cp.n_threads_batch = threads;
        cp.flash_attn_type = LLAMA_FLASH_ATTN_TYPE_DISABLED;
        cp.type_k = GGML_TYPE_F32;
        cp.type_v = GGML_TYPE_F32;
        cp.op_offload = false;
        cp.offload_kqv = false;
        cp.no_perf = true;
        llama_context * ctx = llama_init_from_model(model, cp);
        if (!ctx) { fprintf(stderr, "%s: cannot make a context\n", id.c_str()); return 1; }

        std::ostringstream js;
        js << "{\"id\":\"" << id << "\",\"vocab\":" << n_vocab << ",\"embd\":" << n_embd << ",\"chunks\":[";
        FILE * fp = fopen((out_dir + "/" + id + ".prefill.f32").c_str(), "wb");
        llama_pos n_past = 0;
        int last = -1;
        double encode_ms = 0, prefill_ms = 0;
        for (size_t c = 0; c < n_chunks; c++) {
            const mtmd_input_chunk * ch = mtmd_input_chunks_get(chunks, c);
            js << (c ? "," : "");
            if (mtmd_input_chunk_get_type(ch) == MTMD_INPUT_CHUNK_TYPE_TEXT) {
                size_t n = 0;
                const llama_token * toks = mtmd_input_chunk_get_tokens_text(ch, &n);
                js << "{\"text\":[";
                for (size_t i = 0; i < n; i++) js << (i ? "," : "") << toks[i];
                js << "]}";
                if (!n) continue;
                llama_batch batch = llama_batch_init(n, 0, 1);
                for (size_t i = 0; i < n; i++) {
                    batch.token[i] = toks[i]; batch.pos[i] = n_past + i; batch.n_seq_id[i] = 1; batch.seq_id[i][0] = 0; batch.logits[i] = 1;
                }
                batch.n_tokens = n;
                const double t0 = now_ms();
                if (llama_decode(ctx, batch)) { fprintf(stderr, "%s: text chunk %zu failed\n", id.c_str(), c); return 1; }
                prefill_ms += now_ms() - t0;
                for (size_t i = 0; i < n; i++) fwrite(llama_get_logits_ith(ctx, i), sizeof(float), n_vocab, fp);
                last = argmax(llama_get_logits_ith(ctx, n - 1), n_vocab);
                llama_batch_free(batch);
                n_past += n;
            } else {
                const int n = (int) mtmd_input_chunk_get_n_tokens(ch);
                js << "{\"image\":" << n << "}";
                const double t0 = now_ms();
                if (mtmd_encode_chunk(mctx, ch)) { fprintf(stderr, "%s: encode failed\n", id.c_str()); return 1; }
                encode_ms += now_ms() - t0;
                float * embd = mtmd_get_output_embd(mctx);
                FILE * fe = fopen((out_dir + "/" + id + ".embd.f32").c_str(), "wb");
                fwrite(embd, sizeof(float), (size_t) n * n_embd, fe);
                fclose(fe);
                llama_pos next = 0;
                const double t1 = now_ms();
                if (mtmd_helper_decode_image_chunk(mctx, ctx, ch, embd, n_past, 0, n_total, &next, nullptr, nullptr)) { fprintf(stderr, "%s: image decode failed\n", id.c_str()); return 1; }
                prefill_ms += now_ms() - t1;
                n_past = next;
                last = -1;
            }
        }
        fclose(fp);
        if (last < 0) { fprintf(stderr, "%s: the prompt must end in text\n", id.c_str()); return 1; }

        std::vector<int> gen = { last };
        FILE * fd = fopen((out_dir + "/" + id + ".decode.f32").c_str(), "wb");
        const double t2 = now_ms();
        for (int s = 0; s < steps; s++) {
            llama_batch one = llama_batch_init(1, 0, 1);
            one.token[0] = gen.back(); one.pos[0] = n_past + s; one.n_seq_id[0] = 1; one.seq_id[0][0] = 0; one.logits[0] = 1;
            one.n_tokens = 1;
            if (llama_decode(ctx, one)) { fprintf(stderr, "%s: decode %d failed\n", id.c_str(), s); return 1; }
            const float * lg = llama_get_logits_ith(ctx, 0);
            fwrite(lg, sizeof(float), n_vocab, fd);
            gen.push_back(argmax(lg, n_vocab));
            llama_batch_free(one);
        }
        const double decode_ms = now_ms() - t2;
        fclose(fd);
        llama_free(ctx);
        mtmd_input_chunks_free(chunks);
        mtmd_bitmap_free(bmp);

        js << "],\"gen\":[";
        for (size_t i = 0; i < gen.size(); i++) js << (i ? "," : "") << gen[i];
        js << "],\"encodeMs\":" << encode_ms << ",\"prefillMs\":" << prefill_ms << ",\"decodeMs\":" << decode_ms << "}\n";
        std::ofstream(out_dir + "/" + id + ".json") << js.str();
        fprintf(stderr, "%s: %zu prompt tokens, encode %.0f ms, prefill %.0f ms, %d decoded in %.0f ms\n", id.c_str(), n_total, encode_ms, prefill_ms, steps, decode_ms);
    }
    mtmd_free(mctx);
    llama_model_free(model);
    llama_backend_free();
    return 0;
}
