import json, sys, zipfile, os

try:
    data = json.loads(sys.stdin.read())
except Exception:
    sys.exit(0)

file_path = (
    data.get("tool_input", {}).get("file_path")
    or data.get("file_path")
    or ""
)

if os.path.basename(file_path) != "index.html":
    sys.exit(0)

zp = "/home/emi/Projects/Francine/deploy.zip"
try:
    with zipfile.ZipFile(zp, "r") as zi:
        redirects = zi.read("_redirects")
    with zipfile.ZipFile(zp, "w", zipfile.ZIP_DEFLATED) as zo:
        zo.write("/home/emi/Projects/Francine/index.html", "index.html")
        zo.writestr("_redirects", redirects)
except Exception as e:
    print(f"rebuild-zip failed: {e}", file=sys.stderr)
    sys.exit(1)
