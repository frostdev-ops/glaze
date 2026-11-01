# HF transformers' logits for checks/ai/local-reference-check.js compare: LiquidAI/LFM3-1.7B at ac2586a3 (bf16 weights) on
# the GPU, fed the token ids of a llama.cpp run, written in the same layout (<id>.json, .prefill.f32, .decode.f32).
# Not part of the suite. In the glaze-train image on the Linux runner:
#   docker run --rm --gpus all -v ~/glaze-train/hf:/hf -e HF_HOME=/hf -e HF_HUB_OFFLINE=1 -v <dir>:/work glaze-train:1 \
#     python -I /work/local-reference-hf.py /work/<llama run> /work/<out> bf16|fp32 [steps]
import json, os, sys, time
import torch
from huggingface_hub import snapshot_download
from transformers import AutoModelForCausalLM

REPO, REV = "LiquidAI/LFM3-1.7B", "ac2586a34f1a1c03329dbdcdefabd8b6478ddaa7"
src, out, dtype = sys.argv[1], sys.argv[2], sys.argv[3]
steps = int(sys.argv[4]) if len(sys.argv) > 4 else 64
os.makedirs(out, exist_ok=True)
torch.backends.cuda.matmul.allow_tf32 = False
torch.backends.cudnn.allow_tf32 = False
model = AutoModelForCausalLM.from_pretrained(snapshot_download(REPO, revision=REV), dtype=torch.bfloat16 if dtype == "bf16" else torch.float32, device_map="cuda", trust_remote_code=True)
model.eval()
ids = [f[:-5] for f in sorted(os.listdir(src)) if f.endswith(".json")]
with torch.no_grad():
    for pid in ids:
        want = json.load(open(os.path.join(src, pid + ".json")))
        x = torch.tensor([want["prompt"]], device="cuda")
        t = time.time()
        res = model(input_ids=x, use_cache=True)
        logits = res.logits[0].float().cpu().numpy()
        logits.tofile(os.path.join(out, pid + ".prefill.f32"))
        gen, past, rows = [int(logits[-1].argmax())], res.past_key_values, []
        for s in range(steps):
            res = model(input_ids=torch.tensor([[gen[-1]]], device="cuda"), past_key_values=past, use_cache=True)
            past = res.past_key_values
            row = res.logits[0, -1].float().cpu().numpy()
            rows.append(row)
            gen.append(int(row.argmax()))
        with open(os.path.join(out, pid + ".decode.f32"), "wb") as fd:
            for row in rows:
                row.tofile(fd)
        json.dump({"id": pid, "vocab": int(logits.shape[-1]), "prompt": want["prompt"], "gen": gen, "dtype": dtype}, open(os.path.join(out, pid + ".json"), "w"))
        print(f"{pid}: {len(want['prompt'])} tokens, {steps} steps, {time.time() - t:.1f} s", flush=True)
