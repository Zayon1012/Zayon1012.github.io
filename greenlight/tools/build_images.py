"""Download official Steam store art listed in image_manifest.json and emit responsive WebP files into ../img.
Usage: python tools/build_images.py   (requires requests + Pillow)"""
import json, os, io, sys, requests
from PIL import Image
here=os.path.dirname(os.path.abspath(__file__)); root=os.path.dirname(here); out=os.path.join(root,"img")
os.makedirs(out,exist_ok=True)
man=json.load(open(os.path.join(here,"image_manifest.json")))
REVIEWED={"dune-awakening","well-dweller","ninja-gaiden-4","keeper","kernel-hearts","runescape-dragonwilds","minecraft-dungeons-ii","mad-king-redemption"}
def get(url):
    for _ in range(3):
        try:
            r=requests.get(url,timeout=40); r.raise_for_status(); return Image.open(io.BytesIO(r.content)).convert("RGB")
        except Exception as e: err=e
    raise err
def save(im,w,path,q=76):
    if os.path.exists(path): return
    im2=im.copy(); im2.thumbnail((w,w*2)); im2.save(path,"WEBP",quality=q,method=6)
for slug,m in man.items():
    save(get(m["header"]),460,f"{out}/{slug}-header.webp",80)
    shots=m["shots"] if slug in REVIEWED else m["shots"][:1]
    for i,u in enumerate(shots):
        im=get(u)
        for w in (400,800,1600): save(im,w,f"{out}/{slug}-{i}-{w}.webp")
    print("ok",slug,flush=True)
