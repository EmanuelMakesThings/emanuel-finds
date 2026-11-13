import sys
import os
from PIL import Image

def generate_icons(src_path):
    if not os.path.exists(src_path):
        print(f"Error: {src_path} not found")
        sys.exit(1)

    img = Image.open(src_path).convert("RGBA")
    w, h = img.size
    print(f"Source image loaded: {src_path} ({w}x{h})")

    # Crop to square if needed
    min_dim = min(w, h)
    left = (w - min_dim) // 2
    top = (h - min_dim) // 2
    img = img.crop((left, top, left + min_dim, top + min_dim))

    # 1. Desktop Icons
    os.makedirs("build", exist_ok=True)
    img_512 = img.resize((512, 512), Image.Resampling.LANCZOS)
    img_512.save("build/icon.png")
    img.save("build/icon.ico", format="ICO", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    print("Generated build/icon.png and build/icon.ico")

    # 2. Android Mipmap Icons
    res_dir = "mobile/android/app/src/main/res"
    # standard launcher sizes: (name, launcher_size, foreground_size)
    android_sizes = [
        ("mipmap-mdpi", 48, 108),
        ("mipmap-hdpi", 72, 162),
        ("mipmap-xhdpi", 96, 216),
        ("mipmap-xxhdpi", 144, 324),
        ("mipmap-xxxhdpi", 192, 432),
    ]

    for folder, l_sz, fg_sz in android_sizes:
        target_folder = os.path.join(res_dir, folder)
        os.makedirs(target_folder, exist_ok=True)

        # Standard launcher icon
        icon_img = img.resize((l_sz, l_sz), Image.Resampling.LANCZOS)
        icon_img.save(os.path.join(target_folder, "ic_launcher.png"))
        icon_img.save(os.path.join(target_folder, "ic_launcher_round.png"))

        # Foreground for adaptive icon
        # In adaptive icons, the center 66% is safe zone, so we place the icon nicely centered
        fg_canvas = Image.new("RGBA", (fg_sz, fg_sz), (0, 0, 0, 0))
        # resize subject to ~80% of canvas
        subj_sz = int(fg_sz * 0.82)
        subj_img = img.resize((subj_sz, subj_sz), Image.Resampling.LANCZOS)
        offset = (fg_sz - subj_sz) // 2
        fg_canvas.paste(subj_img, (offset, offset), subj_img)
        fg_canvas.save(os.path.join(target_folder, "ic_launcher_foreground.png"))

        print(f"Generated {folder}: {l_sz}x{l_sz} and foreground {fg_sz}x{fg_sz}")

    print("All icons successfully generated!")

if __name__ == "__main__":
    src = sys.argv[1] if len(sys.argv) > 1 else "scratch/icon_src.png"
    generate_icons(src)
