import re
import requests

js = requests.get("https://smlouvy.gov.cz/js/app.js", headers={"User-Agent": "Mozilla/5.0"}).text
print("len", len(js))
for key in ["api", "vyhledavani", "nette", "snippet", "ajax", "smlouva", "json"]:
    if key in js.lower():
        print("has", key)

for line in js.splitlines():
    low = line.lower()
    if "vyhled" in low or "ajax" in low or "snippet" in low or "/api" in low:
        print(line[:240])
