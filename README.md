# Super Volley Ball (Mega Drive / Genesis) — PC Windows Edition

Recriação nativa para **Windows (PC)** do clássico **Super Volley Ball** (*SEGA Mega Drive / Genesis, 1991 — Video System / Micronics, Serial `GM T-30016-00`*), construída a partir da engenharia reversa binária da ROM original utilizando a metodologia do **[morluto/rea (Reverse Engineer Anything)](https://github.com/morluto/rea)**.

---

## Como Executar no Windows

1. **Executável Nativo Windows (`.exe`)**:
   - Dê dois cliques em **[SuperVolleyBall.exe](file:///C:/Users/flavi/.gemini/antigravity/scratch/super-volleyball-pc/SuperVolleyBall.exe)** (ou em `Jogar_SuperVolleyBall.bat`).
   - Dentro do executável, você pode jogar diretamente em 60 FPS ou pressionar **`F10`** para abrir a **Edição Web Arcade com Sintetizador FM YM2612 + CRT Shader + REA ROM Inspector**.
2. **Edição Web Arcade (HTML5 Canvas + YM2612 FM Synth + REA Inspector)**:
   - Abra **[index.html](file:///C:/Users/flavi/.gemini/antigravity/scratch/super-volleyball-pc/index.html)** em qualquer navegador (Edge / Chrome) ou clique no botão `F10` dentro do `SuperVolleyBall.exe`.
3. **Extrator de Engenharia Reversa (`rea_extractor.py`)**:
   - Execute `python rea_extractor.py` para reprocessar a ROM original `Super Volley Ball (USA).md` e regerar `rom_data.json`, `rom_data.js` e as folhas de sprites/tiles VDP em `assets/`.

---

## Dados Extraídos Diretamente da ROM (`Super Volley Ball (USA).md`)

| Região da ROM | Conteúdo Descoberto e Extraído |
| :--- | :--- |
| `0x00000 - 0x001FF` | Vetores Motorola 68000 (`Entry PC: 0x000206`, `HBlank: 0x00039E`, `VBlank: 0x000694`) e Cabeçalho `SEGA GENESIS (C)T-30 1990.AUG` |
| `0x12EE0 - 0x14F38` | Textos codificados na VDP (offset `+9` e `-39`): Menus, *World League*, *Team Edit*, *Options*, frases do técnico e *Staff Roll* (`STAFF`) |
| `0x142A0 - 0x1461F` | 28 Paletas de Cores CRAM 9-bit do Mega Drive (uniformes oficiais de todas as seleções, quadra e interface) |
| `0x14F3A - 0x15039` | Tabela das 8 Seleções Internacionais (`USA`, `URS`, `BRA`, `HOL`, `FRA`, `ITA`, `JPN`, `CHN`) + Seleções Secretas (`???` / `URAWAZA`) |
| `0x1503A - 0x15799` | Banco de dados de 116 jogadores (registros de 16 bytes: 10 bytes nome VDP + camisa `#` + atributos `SP`, `RE`, `SV`, `BL` e função) |
| `0x18000 - 0x1D6F7` | Catálogo de 45 SFX (`FuePeeK`, `SpikeOku1`, `Makyuu3`, `ServeNew1`, `Toss1`, `NewBlock2`, `NewRecv1`) e 32 instrumentos FM YM2612 (`AnaBassED`, `Itamarimba`, `PowerBrass`) |
| `0x20000 - 0x3FFFF` | Bancos de Tiles Gráficos VDP 4bpp (`8x8`): fontes, placar, torcida, troféu, juiz, sprites dos atletas e logotipo `SUPER VOLLEY BALL` |
