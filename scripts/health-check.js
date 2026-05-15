const url = process.argv[2] ?? "http://localhost:5174/api/health";

const response = await fetch(url);
const payload = await response.json();

if (!response.ok || !payload.ok) {
  console.error(JSON.stringify(payload));
  process.exit(1);
}

console.log(JSON.stringify(payload));
