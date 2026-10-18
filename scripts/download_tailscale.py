"""Download the official, checksum-verified Windows installer for this setup."""
from pathlib import Path
import hashlib
import httpx

target = Path(__file__).resolve().parents[1] / '.cache' / 'installers' / 'tailscale-setup-1.104.1-amd64.msi'
target.parent.mkdir(parents=True, exist_ok=True)
url = 'https://pkgs.tailscale.com/stable/' + target.name
with httpx.Client(trust_env=False, timeout=120, follow_redirects=False) as client:
    expected_response = client.get(url + '.sha256')
    expected_response.raise_for_status()
    expected = expected_response.text.strip().split()[0]
    with client.stream('GET', url) as response:
        response.raise_for_status()
        with target.open('wb') as output:
            for chunk in response.iter_bytes():
                output.write(chunk)
actual = hashlib.sha256(target.read_bytes()).hexdigest()
if actual.lower() != expected.lower():
    raise RuntimeError('Official checksum mismatch; installer will not be launched.')
print(str(target))
print('SHA256 verified:', actual)
