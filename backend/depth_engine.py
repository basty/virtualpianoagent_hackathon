import sys
import os
import cv2
import torch
import numpy as np
import base64

# Add Depth-Anything-V2 repository to sys.path so we can import it
repo_path = os.path.join(os.path.dirname(__file__), 'Depth-Anything-V2')
if repo_path not in sys.path:
    sys.path.append(repo_path)

from depth_anything_v2.dpt import DepthAnythingV2

_model = None
_device = None

def init_model(model_name="vits"):
    """
    Initializes the Depth Anything V2 model.
    Defaults to 'vits' (Small) to prioritize fast inference.
    """
    global _model, _device
    
    _device = 'cuda' if torch.cuda.is_available() else 'mps' if torch.backends.mps.is_available() else 'cpu'
    print(f"[DepthEngine] Initializing '{model_name}' on {_device}...")
    
    model_configs = {
        'vits': {'encoder': 'vits', 'features': 64, 'out_channels': [48, 96, 192, 384]},
        'vitb': {'encoder': 'vitb', 'features': 128, 'out_channels': [96, 192, 384, 768]},
        'vitl': {'encoder': 'vitl', 'features': 256, 'out_channels': [256, 512, 1024, 1024]},
    }
    
    if model_name not in model_configs:
        raise ValueError(f"Unknown model_name: {model_name}")

    _model = DepthAnythingV2(**model_configs[model_name])
    
    ckpt_path = os.path.join(os.path.dirname(__file__), f'checkpoints/depth_anything_v2_{model_name}.pth')
    if not os.path.exists(ckpt_path):
        raise FileNotFoundError(f"Missing checkpoint: {ckpt_path}\nPlease download the {model_name} model checkpoint.")
        
    _model.load_state_dict(torch.load(ckpt_path, map_location='cpu'))
    
    # Robust device check: even if torch says available, the specific GPU might be incompatible (sm_XX version)
    try:
        # Test a small operation on the device
        test_tensor = torch.zeros(1).to(_device)
        print(f"[DepthEngine] Device '{_device}' verified with test operation.")
    except Exception as device_err:
        print(f"[DepthEngine] Device '{_device}' failed compatibility test: {device_err}")
        print("[DepthEngine] Falling back to CPU.")
        _device = 'cpu'

    try:
        _model = _model.to(_device).eval()
    except Exception as e:
        print(f"[DepthEngine] Failed to move model to {_device}: {e}. Falling back to CPU...")
        _device = 'cpu'
        _model = _model.to(_device).eval()
        
    print(f"[DepthEngine] Model loaded successfully on {_device}.")
    sys.stdout.flush()

def predict_depth_base64(image_bytes: bytes) -> str:
    """
    Takes an input image buffer (e.g. JPEG bytes), runs depth inference,
    and returns a base64 encoded grayscale JPEG of the depth map.
    """
    if _model is None:
        raise RuntimeError("Model NOT initialized. Call init_model() first.")

    # Decode bytes to BGR image
    nparr = np.frombuffer(image_bytes, np.uint8)
    image = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError("Failed to decode image bytes")
        
    # Resize to constrain max dimension to ~518 for real-time performance
    # Depth Anything V2 internally resizes to nearest multiple of 14, but manually constraining it helps API latency
    h, w = image.shape[:2]
    max_dim = 518
    if max(h, w) > max_dim:
        scale = max_dim / max(h, w)
        image = cv2.resize(image, (int(w * scale), int(h * scale)))
        
    # Run depth inference
    try:
        # print(f"[DepthEngine] Running inference on {image.shape}...")
        with torch.no_grad():
            depth = _model.infer_image(image) # Returns numpy array float32 (H, W)
        # print("[DepthEngine] Inference done.")
    except Exception as e:
        print(f"[DepthEngine] Inference FAILED: {e}")
        raise e
        
    # Normalize depth map to 0-255 uint8 to send via network
    d_min, d_max = depth.min(), depth.max()
    if d_max - d_min > 0:
        depth_normalized = (depth - d_min) / (d_max - d_min)
    else:
        depth_normalized = depth
    
    depth_uint8 = (depth_normalized * 255.0).astype(np.uint8)
    
    # Optionally apply colormap or just send raw grayscale
    # We will send raw grayscale so the frontend can easily read the values from canvas
    _, encoded = cv2.imencode('.jpg', depth_uint8, [cv2.IMWRITE_JPEG_QUALITY, 80])
    
    return base64.b64encode(encoded).decode('utf-8')
