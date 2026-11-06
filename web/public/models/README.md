# Local image models

Both models are unmodified and run locally in a cancellable ONNX Runtime Web 1.31.1 WASM worker (MIT). No image is uploaded. The application verifies SHA-256 before inference. Models and WASM ship in the installer and require no runtime download.

- **U²-Netp**: U²-Net by Xuebin Qin et al., Apache-2.0. Upstream: https://github.com/xuebinqin/U-2-Net . Unmodified weights distributed by https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2netp.onnx . SHA-256: `309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8`. The 320×320 analysis mask is mapped back to the original image dimensions; original alpha is multiplied by the mask.
- **ESPCN 3×**: ONNX Model Zoo sub-pixel CNN, Apache-2.0. https://github.com/onnx/models/tree/c5cae0f1942c8d7727372c7b1f6b485aa39e4421/validated/vision/super_resolution/sub_pixel_cnn_2016 . `super-resolution-10.onnx`, SHA-256: `85f36ff88cc504a24af5e0602148bc56a8aa09a58eca8c0da2756f3e8186035e`. Predicts Y luminance at 3×; chroma/alpha use smooth sampling. Fixed 224×224 inference tiles use five source pixels of context on each edge, matching the four 5/3/3/3 convolutions' receptive field. Only the valid center is stitched; replicated padding is used at the actual image edges. Inputs are never resized to fit the model. The result is exactly 3× original width/height; it is not Real-ESRGAN.

Apache-2.0 text: `LICENSE-Apache-2.0.txt`. ONNX Runtime license: https://github.com/microsoft/onnxruntime/blob/v1.31.1/LICENSE . Model output quality varies with the source; the original file is retained.
