# Morning photo ingest

A Linux job can add photos to a project's Photos Pool without signing in to the portal. The endpoint lives at the **domain root** (not under `/projectprogress`). It uses the same Spaces keys, database rows, and thumbnails as a drag-and-drop upload in Photo Storage.

Set **`PHOTO_INGEST_KEY`** on the DigitalOcean App Platform web service (encrypted). If that variable is missing or blank, both endpoints return **503**. The key is not a portal password and it does not start a session.

Send it on every request:

```http
Authorization: Bearer <PHOTO_INGEST_KEY>
```

The comparison is constant-time. A missing or wrong token returns **401**.

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/projects/:projectIdOrName/photos` | List stored file names so the job can skip files it already sent |
| `POST` | `/api/projects/:projectIdOrName/photos/ingest` | Upload one or many images |

`:projectIdOrName` is the project id **or** the project name, exact match, including spaces. URL-encode the name. Example project name: `MTVH 2026`.

```bash
curl -sS \
  -H "Authorization: Bearer $PHOTO_INGEST_KEY" \
  "https://savillscloudportal.co.uk/api/projects/MTVH%202026/photos"
```

```json
{ "names": ["2245623-Kitchen-1.jpg", "2245623-Lounge-1.jpg"], "count": 2 }
```

`names` are the stored file names. The photo **code** is the filename stem (everything before the extension). The stem is kept character for character, including capitals. The extension is stored the same way as a Photos Pool upload: lower case, and `.jpeg` is saved as `.jpg`. `Kitchen.JPEG` is stored as code `Kitchen` and file name `Kitchen.jpg`. Compare stems without regard to case, and treat `.jpeg` and `.jpg` as the same photo, when you pre-filter.

## Upload

Send `multipart/form-data`. Repeat the field `files` (or send one file as `file`). Accepted types: JPEG, PNG, WebP, HEIC, HEIF. Each file can be up to **50 MB**. One request can include up to **40** files; call again for the next batch.

A name that already exists in that project's Photos Pool is **skipped**. The stored object is not replaced. Two files in the same request that share a stem are the same: the first is stored, the second is skipped.

```bash
curl -sS -X POST \
  -H "Authorization: Bearer $PHOTO_INGEST_KEY" \
  -F "files=@/home/photos/in/2245623-Kitchen-1.jpg" \
  -F "files=@/home/photos/in/2245623-Lounge-1.JPEG" \
  "https://savillscloudportal.co.uk/api/projects/MTVH%202026/photos/ingest"
```

```json
{
  "uploaded": ["2245623-Kitchen-1.jpg", "2245623-Lounge-1.JPEG"],
  "skipped": [],
  "failed": []
}
```

`uploaded` and `skipped` use the filename you sent. `failed` is `{ "name", "error" }` for a file that was rejected (wrong type, empty, or storage error). The HTTP status is **200** when the batch was processed, including when some files failed. **404** means the project id or exact name was not found. **413** means a file was over 50 MB or the request had more than 40 files. **503** means `PHOTO_INGEST_KEY` is unset, or Spaces is not configured.

Python (stdlib only):

```python
import json, os, urllib.request

key = os.environ["PHOTO_INGEST_KEY"]
url = "https://savillscloudportal.co.uk/api/projects/MTVH%202026/photos"
req = urllib.request.Request(url, headers={"Authorization": f"Bearer {key}"})
with urllib.request.urlopen(req) as res:
    print(json.load(res)["count"])
```

Use `curl` (or any HTTP client that can post multipart) for the upload. Do not put the key in the URL.
