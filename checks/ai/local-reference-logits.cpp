// llama.cpp's next-token logits for scripts/local-reference-check.js: for each prompt, the logits at every prompt position
// (one batch) and over greedy decode steps (one token each), from llama.cpp on the CPU only. Not part of the suite.
// Numerics kept plain: only the CPU backend is loaded (no Metal, no BLAS), f32 K and V cache, flash attention off, no
// op offload, no weight repacking. The CPU still quantizes each matmul's activations (Q8_K for K-quants, Q8_0 for
// Q8_0/Q4_0 weights) before its integer dot products.
//   clang++ -std=c++17 -O2 scripts/local-reference-logits.cpp -I/opt/homebrew/opt/llama.cpp/include \
//     -I/opt/homebrew/opt/ggml/include -L/opt/homebrew/opt/llama.cpp/lib -L/opt/homebrew/opt/ggml/lib -lllama -lggml \
//     -lggml-base -Wl,-rpath,/opt/homebrew/opt/llama.cpp/lib -Wl,-rpath,/opt/homebrew/opt/ggml/lib -o llama-logits
//   (or with a CPU-only llama.cpp build of the same commit: -I<src>/include -I<src>/ggml/include, its libllama and libggml*)
//   llama-logits <model.gguf> <cpu backend .so, or - when it is built in> <prompts.tsv> <out dir> <decode steps> <threads>
// prompts.tsv: one prompt a line, `id<TAB>max tokens (0: all)<TAB>text` with \n, \t and \\ escaped. Special tokens in
// the text are parsed. Writes <id>.json { tokens, prompt, gen } and <id>.prefill.f32 / <id>.decode.f32 (rows of n_vocab
// floats): prefill row i predicts token i+1; gen[0] is the prefill's argmax and decode row s, after feeding gen[s],
// gives gen[s+1].
#include "ggml-backend.h"
#include "llama.h"

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

// llama.cpp's log, less its per-graph chatter: warnings, errors and where each buffer went.
static void log_filter(ggml_log_level level, const char * text, void *) {
    if (level >= GGML_LOG_LEVEL_WARN || strstr(text, "buffer size") || strstr(text, "device")) fputs(text, stderr);
}

static int argmax(const float * v, int n) {
    int b = 0;
    for (int i = 1; i < n; i++) if (v[i] > v[b]) b = i;
    return b;
}

int main(int argc, char ** argv) {
    if (argc != 7) {
        fprintf(stderr, "usage: %s model.gguf cpu-backend.so prompts.tsv out-dir decode-steps threads\n", argv[0]);
        return 2;
    }
    const std::string out_dir = argv[4];
    const int steps = atoi(argv[5]);
    const int threads = atoi(argv[6]);

    llama_log_set(log_filter, nullptr);
    if (strcmp(argv[2], "-") && !ggml_backend_load(argv[2])) { fprintf(stderr, "cannot load %s\n", argv[2]); return 1; }
    llama_backend_init();
    if (!ggml_backend_dev_count()) { fprintf(stderr, "no device\n"); return 1; }
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

    std::ifstream in(argv[3]);
    std::string line;
    while (std::getline(in, line)) {
        if (line.empty()) continue;
        const size_t a = line.find('\t'), b = line.find('\t', a + 1);
        const std::string id = line.substr(0, a);
        const int max_tokens = atoi(line.substr(a + 1, b - a - 1).c_str());
        const std::string text = unescape(line.substr(b + 1));

        std::vector<llama_token> toks(text.size() + 16);
        int n = llama_tokenize(vocab, text.c_str(), (int) text.size(), toks.data(), (int) toks.size(), false, true);
        if (n < 0) { fprintf(stderr, "%s: tokenize failed\n", id.c_str()); return 1; }
        toks.resize(n);
        if (max_tokens > 0 && n > max_tokens) { toks.resize(max_tokens); n = max_tokens; }

        llama_context_params cp = llama_context_default_params();
        cp.n_ctx = n + steps + 16;
        cp.n_batch = cp.n_ubatch = n;
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

        llama_batch batch = llama_batch_init(n, 0, 1);
        for (int i = 0; i < n; i++) {
            batch.token[i] = toks[i]; batch.pos[i] = i; batch.n_seq_id[i] = 1; batch.seq_id[i][0] = 0; batch.logits[i] = 1;
        }
        batch.n_tokens = n;
        if (llama_decode(ctx, batch)) { fprintf(stderr, "%s: prefill failed\n", id.c_str()); return 1; }

        FILE * fp = fopen((out_dir + "/" + id + ".prefill.f32").c_str(), "wb");
        for (int i = 0; i < n; i++) fwrite(llama_get_logits_ith(ctx, i), sizeof(float), n_vocab, fp);
        fclose(fp);

        std::vector<int> gen;
        gen.push_back(argmax(llama_get_logits_ith(ctx, n - 1), n_vocab));
        FILE * fd = fopen((out_dir + "/" + id + ".decode.f32").c_str(), "wb");
        for (int s = 0; s < steps; s++) {
            llama_batch one = llama_batch_init(1, 0, 1);
            one.token[0] = gen.back(); one.pos[0] = n + s; one.n_seq_id[0] = 1; one.seq_id[0][0] = 0; one.logits[0] = 1;
            one.n_tokens = 1;
            if (llama_decode(ctx, one)) { fprintf(stderr, "%s: decode %d failed\n", id.c_str(), s); return 1; }
            const float * lg = llama_get_logits_ith(ctx, 0);
            fwrite(lg, sizeof(float), n_vocab, fd);
            gen.push_back(argmax(lg, n_vocab));
            llama_batch_free(one);
        }
        fclose(fd);
        llama_batch_free(batch);
        llama_free(ctx);

        std::ostringstream js;
        js << "{\"id\":\"" << id << "\",\"vocab\":" << n_vocab << ",\"prompt\":[";
        for (int i = 0; i < n; i++) js << (i ? "," : "") << toks[i];
        js << "],\"gen\":[";
        for (size_t i = 0; i < gen.size(); i++) js << (i ? "," : "") << gen[i];
        js << "]}\n";
        std::ofstream(out_dir + "/" + id + ".json") << js.str();
        fprintf(stderr, "%s: %d prompt tokens, %d decoded\n", id.c_str(), n, steps);
    }
    llama_model_free(model);
    llama_backend_free();
    return 0;
}
