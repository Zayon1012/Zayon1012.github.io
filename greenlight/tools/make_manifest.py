import requests, json
apps = {"dune-awakening":1172710,"well-dweller":3699590,"ninja-gaiden-4":2627260,"keeper":3043580,"kernel-hearts":2902170,"runescape-dragonwilds":1374490,"minecraft-dungeons-ii":1912410,"mad-king-redemption":2369580,"gears-of-war-e-day":3010850,
"marvel-cosmic-invasion":2753970,"planet-of-lana-ii":2997230,"routine":606160,"ultimate-sheep-raccoon":2923350,"call-of-duty-black-ops-6":2933620,"rematch":2138720}
man={}
for slug,a in apps.items():
    d=requests.get(f"https://store.steampowered.com/api/appdetails?appids={a}&cc=us&l=en").json()[str(a)]
    if not d.get("success"): print("FAIL",slug,a); continue
    d=d["data"]; ss=[s["path_full"].split("?")[0] for s in d.get("screenshots",[])[:6]]
    man[slug]={"steam":a,"name":d["name"],"header":d["header_image"].split("?")[0],"shots":ss}
    print(slug,d["name"],len(ss))
json.dump(man,open("tools/image_manifest.json","w"),indent=1)
