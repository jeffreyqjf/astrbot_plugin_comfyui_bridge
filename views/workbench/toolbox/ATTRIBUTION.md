# Attribution

`ComfyUI-H3-ClipStream` is a single ComfyUI plugin that combines two
independent, open-source upstream projects. Both are bundled here with credit;
the combined work is distributed under the stricter of their licenses, **GPLv3**.

## 1. Motion-Context continuation engine
* Upstream: [NikoDemon80/ComfyUI-H3-Motion-Context](https://github.com/NikoDemon80/ComfyUI-H3-Motion-Context)
* Author: NikoDemon80
* License: **GPLv3** (see `LICENSE`)
* Upstream baseline used here: `518c083` ("Release 0.7.1"). The previous
  vendored baseline was `5335715` (0.6.2). `scripts/sync_upstream.sh` tracks the
  delta and classifies every upstream file as VERBATIM / PORTED / LOCAL_ONLY.
* Bundled here as the `motion_context/` sub-package, verbatim:
  `nodes.py`, `layout_contract.py`, `csrf_guard.py`, `probe_node.py`,
  and `web/h3_motion_context.js`.
* Ported from the same upstream on 2026-10-18 - the algorithm and the docstrings
  are verbatim; only the node class is rewritten for the ComfyUI V3 API and the
  node id carries a `ClipStream` suffix so an independently installed upstream
  plugin cannot clash: `refine_blend.py` (Refine Blend), `join_match.py`
  (Join Match), `sigma_tools.py` (Sigmas Tail).

## 2. Clip Bin visual media pool
* Upstream: [knoic/ComfyUI-MiniMaxH3-PrefixStream](https://github.com/knoic/ComfyUI-MiniMaxH3-PrefixStream)
* Author: knoic
* License: **MIT**
* Bundled here as the `clipbin/` sub-package:
  `clip_bin_manager.py`, `clip_bin_api.py`, the Clip Bin Saver/Picker nodes
  (`clipbin/nodes.py`), shared helpers (`clipbin/_shared.py`), and
  `web/clip_bin_picker.js` + `web/clip_bin_picker.css`.

The Clip Bin was extracted from PrefixStream and **decoupled from its
continuation engine** (the PrefixStream "Native Masked AV / Safe Native"
nodes and their `cache_manager` / `native_masked_av` / `fused_attention` /
`rope_aligner` dependencies are intentionally *not* included). Continuation is
provided by Motion-Context instead.

The Dual Saver/Picker pair (`clipbin/dual_nodes.py`, `clipbin/dual_manager.py`)
is **original work of the ClipStream author** (AraneaQwQ), not taken from
either upstream.

## 3. Legacy widget-width compatibility
* Problem reference: [Comfy-Org/ComfyUI_frontend#12443](https://github.com/Comfy-Org/ComfyUI_frontend/issues/12443)
* Prior workaround: [pekkAi-dev/ComfyUI-LegacyWidgetWidthFix](https://github.com/pekkAi-dev/ComfyUI-LegacyWidgetWidthFix)
* Toolbox files: `web/refs/legacy_widget_width.js`, `web/refs/legacy_widget_width_core.js`

The local standalone repository has no license file. Its code is not copied
verbatim here. Toolbox uses an independently written, host-activated
implementation that shares the marker names `__lwwf_width` and
`__lwwf_guarded`, so it can coexist with that workaround.

## 3. Two-pass helpers (`refs/two_pass.py`)
* **H3 Sigma Refiner** - from ComfyUI-YCNodes-MiniMax-H3 (`py/h3_sigma_refiner.py`),
  author 亦诚 (yc), license **MIT** ("Copyright (c) 2026 yc"). `refine_sigmas` keeps the
  algorithm unchanged; it is used by the "H3 两采 Sigma" node.
* **Two-Pass Latent Reconcile** - from [T8mars/comfyui-minimax-h3-audio-T8](https://github.com/T8mars/comfyui-minimax-h3-audio-T8)
  (`h3_t8/learned_latent_upscale_advanced.py`: `reconcile_two_pass_h3_latent` and its helpers),
  copyright (C) 2026 MiniMax H3 Audio T8 contributors, license **GPL-3.0-or-later**. Behaviour is
  unchanged; error messages were translated to Chinese. Used by the "H3 二采准备" node.
* `tools/test_two_pass.py` checks both ports against the installed originals (identical outputs).

---

MIT code may be incorporated into a GPLv3 work, so the whole plugin is
distributed as GPLv3. If you redistribute, keep this attribution and the
`LICENSE` file intact.
