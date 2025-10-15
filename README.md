

## Hur man startar applikationen

### 1. Installera dependencies

```bash
npm install
```


### 2. Starta Redis (Docker)

```bash
docker-compose up -d redis
```

### 4. Starta appen lokalt

Terminal 1 (API):
```bash
npm start
```

Terminal 2 (Worker):
```bash
npm run worker
```

Öppna: **http://localhost:3000**

---

## 🐳 Docker Production Deploy

```bash
docker-compose up -d
```

Detta startar:
- Redis (port 6379)
- API (port 3000)
- 2× Workers

---

## 📋 Användning

1. **Ladda upp CSV** - Från t.ex. Apify Google Maps scraper (kolumner: `title`, `website`, `phone`)
2. **Konfigurera inställningar**:
   - Max sidor per site: 1-10 (rekommenderat: 5)
   - Samtidiga hämtningar: 1-8 (rekommenderat: 4)
   - Tags: Valfria Mailchimp-taggar
3. **Starta crawling** - Real-time progress visas
4. **Ladda ner resultat**:

### 🔒 Säkerhet & Etik 
- ✅ **Robots.txt-respekt** (RFC 9309) - Hedrar Disallow & Crawl-delay
- ✅ **Per-host rate limiting** - Max 1 req/sek per domän (Bottleneck)
- ✅ **SSRF-skydd** - Blockerar privata IP:n och DNS rebinding
- ✅ **Input validation** - Säker hantering av användarinput
- ✅ **Structured logging** - Winston med PII-maskning
- ✅ **Metrics** - Prometheus-kompatibla metrics på `/metrics`


### ⚖️ Compliance (P2)
- ✅ **Do-Not-Contact lista** - Undvik känsliga/blockerade domäner
- ✅ **TOS-checking** - Flagga restrictive TOS-domäner
- ✅ **Captcha detection** - Skip istället för dyra solving-API:er



