"""インデックス配列 → base64 PNG カラーマップ画像"""
import io
import base64
import numpy as np
from PIL import Image
import matplotlib.cm as cm

COLORMAPS = {
    "ndvi":      ("RdYlGn", -0.2, 1.0),
    "ndre":      ("RdYlGn", -0.1, 0.6),
    "ndwi":      ("RdBu",   -0.5, 0.5),
    "ndmi":      ("YlGnBu", -0.5, 0.8),
    "growth":    ("RdYlGn",  0.0, 0.9),
    "fertility": ("RdYlGn", -0.1, 0.5),
    "weed":      ("RdYlGn_r", 0.0, 1.0),
    "slope":     ("YlOrRd",  0.0, 45.0),
}

LEGEND_LABELS = {
    "growth":    ["低(0.0)", "やや低(0.2)", "普通(0.5)", "良好(0.7)", "優良(0.9)"],
    "fertility": ["不足(-0.1)", "やや不足(0.1)", "適正(0.2)", "やや過剰(0.4)", "過剰(0.5)"],
    "weed":      ["清潔(0.0)", "要観察(0.25)", "要確認(0.5)", "要対応(0.75)", "雑草多(1.0)"],
    "slope":     ["平坦(0°)", "緩傾斜(11°)", "中傾斜(22°)", "急傾斜(33°)", "急峻(45°)"],
}


def to_base64_png(arr: np.ndarray, index_name: str,
                  vmin: float | None = None, vmax: float | None = None) -> tuple[str, list[dict]]:
    """
    インデックス配列を RGBA PNG（base64）と凡例リストに変換する。
    NaN 画素はアルファ 0（透明）になる。
    """
    if index_name == "elevation":
        cmap_name = "terrain"
        if vmin is None:
            vmin = float(np.nanpercentile(arr, 2))
        if vmax is None:
            vmax = float(np.nanpercentile(arr, 98))
    else:
        cmap_name, _vmin, _vmax = COLORMAPS.get(index_name, ("RdYlGn", -0.2, 1.0))
        if vmin is None:
            vmin = _vmin
        if vmax is None:
            vmax = _vmax

    cmap = cm.get_cmap(cmap_name)

    norm = np.clip((arr - vmin) / (vmax - vmin), 0.0, 1.0)
    rgba = (cmap(norm) * 255).astype(np.uint8)
    alpha = np.where(np.isfinite(arr), 220, 0).astype(np.uint8)
    rgba[:, :, 3] = alpha

    img = Image.fromarray(rgba, "RGBA")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    b64 = base64.b64encode(buf.getvalue()).decode()

    # 凡例
    n = 5
    custom_labels = LEGEND_LABELS.get(index_name)
    legend = []
    for i in range(n):
        t = i / (n - 1)
        val = vmin + (vmax - vmin) * t
        r, g, b, _ = cmap(t)
        label = custom_labels[i] if custom_labels else str(round(val, 1))
        legend.append({
            "value": label,
            "color": "#{:02x}{:02x}{:02x}".format(int(r * 255), int(g * 255), int(b * 255)),
        })

    return b64, legend
