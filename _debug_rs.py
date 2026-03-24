import re
import requests

session = requests.Session()
session.headers.update({"User-Agent": "Mozilla/5.0"})

params = {
    "publication_date[from]": "",
    "publication_date[to]": "",
    "subject_name": "město kopřivnice",
    "subject_box": "",
    "subject_idnum": "",
    "subject_address": "",
    "value_foreign[from]": "",
    "value_foreign[to]": "",
    "foreign_currency": "",
    "contract_reference_number": "",
    "contract_id": "",
    "party_name": "",
    "party_box": "",
    "party_idnum": "",
    "party_address": "",
    "value_no_vat[from]": "",
    "value_no_vat[to]": "",
    "file_text": "",
    "version_id": "",
    "contr_num": "",
    "sign_date[from]": "",
    "sign_date[to]": "",
    "contract_descr": "",
    "sign_person_name": "",
    "value_vat[from]": "",
    "value_vat[to]": "",
    "search_type": "0",
    "do": "detailedSearchForm-submit",
    "search": "Vyhledat",
}

session.get("https://smlouvy.gov.cz/vyhledavani")
r = session.get(
    "https://smlouvy.gov.cz/vyhledavani",
    params=params,
    headers={"X-Requested-With": "XMLHttpRequest"},
)
j = r.json()
sn = j.get("snippets", {}).get("snippet-searchResultList-list", "")
print("json keys:", list(j.keys()))
print("snippet len:", len(sn))
print("detail links:", len(re.findall(r'/smlouva/\\d+', sn)))
print("page actions:", len(re.findall(r'do=searchResultList-[^\"& ]+', sn)))
print("first actions:", re.findall(r'do=searchResultList-[^\"& ]+', sn)[:10])
open("_snippet.html", "w", encoding="utf-8").write(sn)
