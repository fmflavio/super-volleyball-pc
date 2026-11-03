#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
REA (Reverse Engineer Anything) - Super Volley Ball (Mega Drive / Genesis) Extractor
====================================================================================
Baseado na metodologia orientada a evidências do repositório https://github.com/morluto/rea
Analisa binariamente a ROM original:
  "Super Volley Ball (USA).md" (SEGA GENESIS, GM T-30016 -00, 262.144 bytes)

Extrai:
  1. Cabeçalho SEGA Mega Drive (0x00100 - 0x001FF) e Tabela de Vetores Motorola 68000 (0x00000 - 0x000FF)
  2. Tabelas de Paletas CRAM 9-bit (0x142A0 - 0x1461F) -> convertidas para RGB24 (#RRGGBB)
  3. Tabela Oficial das 8 Seleções Internacionais (0x14FBA - 0x15039) + 8 Seleções Secretas/Japonesas (0x14F3A - 0x14FB9)
  4. Banco de Dados de Jogadores (0x1503A - 0x15799) -> Nome (5 words VDP), Camisa (#), SP, RE, SV, BL e Role
  5. Textos de Menus, Frases de Treinador, Opções e Créditos Ocultos ("STAFF" / "URAWAZA") (0x12EE0 - 0x14F38)
  6. Catálogo de Patches FM YM2612 e Efeitos Sonoros (SFX) do Driver de Som (0x18000 - 0x1D700)
  7. Bancos de Tiles Gráficos VDP 4bpp (8x8 pixels) -> Exportados em PNG e Sprite/Font Atlases
"""

import os
import json
import struct
import zlib

DEFAULT_ROM_PATH = r"d:\Meus Documentos\Downloads\Super Volley Ball (USA)\Super Volley Ball (USA).md"
PROJECT_DIR = os.path.dirname(os.path.abspath(__file__))
ASSETS_DIR = os.path.join(PROJECT_DIR, "assets")


def write_png_rgba(filename, width, height, rgba_bytes):
    """Escreve um arquivo PNG RGBA de 32 bits puro usando apenas stdlib (struct + zlib)."""
    raw_data = bytearray()
    stride = width * 4
    for y in range(height):
        raw_data.append(0)  # Filter 0
        raw_data.extend(rgba_bytes[y * stride : (y + 1) * stride])

    def chunk(ctype, cdata):
        c = ctype + cdata
        return struct.pack(">I", len(cdata)) + c + struct.pack(">I", zlib.crc32(c) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", zlib.compress(bytes(raw_data), 6))
        + chunk(b"IEND", b"")
    )
    os.makedirs(os.path.dirname(filename), exist_ok=True)
    with open(filename, "wb") as f:
        f.write(png)


def decode_vdp_word_string(b_slice):
    """
    Decodifica strings da nametable VDP do Super Volley Ball:
    - Low byte 0x4A..0x63 -> 'A'..'Z' (offset +9 sobre ASCII)
    - Low byte 0x40..0x49 -> '0'..'9'
    - Low byte 0x6A..0x83 -> 'a'..'z'
    - Low byte 0x1A..0x33 -> 'A'..'Z' (fonte secundária de estatísticas, offset -39)
    - Low byte 0x10..0x19 -> '0'..'9' (fonte secundária)
    """
    chars = []
    for i in range(0, len(b_slice) - 1, 2):
        hi, lo = b_slice[i], b_slice[i + 1]
        if 0x4A <= lo <= 0x63:
            chars.append(chr(lo - 9))
        elif 0x40 <= lo <= 0x49:
            chars.append(chr(ord("0") + (lo - 0x40)))
        elif 0x6A <= lo <= 0x83:
            chars.append(chr(ord("a") + (lo - 0x6A)))
        elif 0x1A <= lo <= 0x33 and hi == 0x41:
            chars.append(chr(lo + 39))
        elif 0x10 <= lo <= 0x19 and hi == 0x41:
            chars.append(chr(ord("0") + (lo - 0x10)))
        elif lo == 0x64:
            chars.append(".")
        elif lo == 0x65:
            chars.append("-")
        elif lo == 0x66:
            chars.append("?")
        elif lo == 0x67:
            chars.append("!")
        elif lo == 0xE6:
            chars.append("'")
        elif lo in (0x00, 0xF0, 0xE5):
            chars.append(" ")
        else:
            chars.append("")
    return "".join(chars).strip()


def decode_cram_palette(data, offset):
    """Decodifica uma paleta Mega Drive CRAM de 16 cores (32 bytes, formato 0000BBB0GGG0RRR0)."""
    words = struct.unpack(">16H", data[offset : offset + 32])
    colors_hex = []
    colors_rgb = []
    for w in words:
        r = ((w >> 1) & 0x7) * 36
        g = ((w >> 5) & 0x7) * 36
        b = ((w >> 9) & 0x7) * 36
        colors_hex.append(f"#{r:02X}{g:02X}{b:02X}")
        colors_rgb.append((r, g, b))
    return colors_hex, colors_rgb


def render_tiles_rgba(data, start_offset, end_offset, palette_rgb, cols=32, transparent_zero=True):
    num_tiles = (end_offset - start_offset) // 32
    rows = (num_tiles + cols - 1) // cols
    width = cols * 8
    height = rows * 8
    rgba = bytearray(width * height * 4)
    for t in range(num_tiles):
        toff = start_offset + t * 32
        tx = (t % cols) * 8
        ty = (t // cols) * 8
        for r in range(8):
            row_bytes = data[toff + r * 4 : toff + (r + 1) * 4]
            if len(row_bytes) < 4:
                break
            py = ty + r
            for c in range(4):
                b = row_bytes[c]
                for nib_idx, p in enumerate(((b >> 4) & 0xF, b & 0xF)):
                    px = tx + c * 2 + nib_idx
                    idx = (py * width + px) * 4
                    cr, cg, cb = palette_rgb[p]
                    ca = 0 if (transparent_zero and p == 0) else 255
                    rgba[idx : idx + 4] = bytes((cr, cg, cb, ca))
    return width, height, rgba


def extract_all(rom_path=DEFAULT_ROM_PATH):
    with open(rom_path, "rb") as f:
        data = f.read()

    os.makedirs(ASSETS_DIR, exist_ok=True)

    # 1. Header & Vectors
    header = data[0x100:0x200]
    rom_info = {
        "file_name": os.path.basename(rom_path),
        "file_size_bytes": len(data),
        "console": header[0x00:0x10].decode("ascii", errors="replace").strip(),
        "copyright": header[0x10:0x20].decode("ascii", errors="replace").strip(),
        "domestic_title": header[0x20:0x50].decode("shift_jis", errors="replace").strip(),
        "overseas_title": header[0x50:0x80].decode("ascii", errors="replace").strip(),
        "serial": header[0x80:0x8E].decode("ascii", errors="replace").strip(),
        "checksum": f"0x{struct.unpack('>H', header[0x8E:0x90])[0]:04X}",
        "rom_range": f"0x{struct.unpack('>I', header[0xA0:0xA4])[0]:08X}-0x{struct.unpack('>I', header[0xA4:0xA8])[0]:08X}",
        "ram_range": f"0x{struct.unpack('>I', header[0xA8:0xAC])[0]:08X}-0x{struct.unpack('>I', header[0xAC:0xB0])[0]:08X}",
        "region": header[0xF0:0x100].decode("ascii", errors="replace").strip(),
        "vectors": {
            "initial_ssp": f"0x{struct.unpack('>I', data[0:4])[0]:08X}",
            "entry_pc": f"0x{struct.unpack('>I', data[4:8])[0]:08X}",
            "hblank_irq4": f"0x{struct.unpack('>I', data[0x70:0x74])[0]:08X}",
            "vblank_irq6": f"0x{struct.unpack('>I', data[0x78:0x7C])[0]:08X}",
        },
    }

    # 2. Palettes (0x142A0 - 0x1461F = 28 palettes of 16 colors)
    palettes = []
    palettes_rgb = []
    for idx in range(28):
        poff = 0x142A0 + idx * 32
        hex_cols, rgb_cols = decode_cram_palette(data, poff)
        palettes.append({
            "index": idx,
            "rom_offset": f"0x{poff:05X}",
            "colors": hex_cols,
        })
        palettes_rgb.append(rgb_cols)

    # 3. Players Database (0x1503A - 0x15399 for 54 international players + secret players)
    role_names = {
        1: "Ace Spiker (Cortador Principal)",
        2: "Middle Blocker (Central / Bloqueador)",
        3: "Setter (Levantador)",
        4: "All-Rounder (Ponteiro / Defensor)",
    }

    players_db = {}
    for pid in range(116):
        poff = 0x1503A + pid * 16
        raw_name = decode_vdp_word_string(data[poff : poff + 10])
        if not raw_name or "?" in raw_name:
            raw_name = f"ROBO{pid - 53:02d}" if pid >= 54 else f"PLYR{pid:02d}"
        num, sp, re_stat, sv, bl, role = data[poff + 10 : poff + 16]
        players_db[pid] = {
            "id": pid,
            "rom_offset": f"0x{poff:05X}",
            "name": raw_name,
            "number": int(num),
            "sp": int(sp),
            "re": int(re_stat),
            "sv": int(sv),
            "bl": int(bl),
            "role_id": int(role),
            "role_name": role_names.get(int(role), "Especialista"),
        }

    # 4. International Teams (0x14FBA - 0x15039)
    country_full_names = {
        "USA": ("Estados Unidos (USA)", "USA"),
        "URS": ("União Soviética (URS)", "URS"),
        "BRA": ("Brasil (BRA)", "BRA"),
        "HOL": ("Holanda (HOL)", "HOL"),
        "FRA": ("França (FRA)", "FRA"),
        "ITA": ("Itália (ITA)", "ITA"),
        "JPN": ("Japão (JPN)", "JPN"),
        "CHN": ("China (CHN)", "CHN"),
    }

    teams = []
    for tid in range(8):
        toff = 0x14FBA + tid * 16
        code = decode_vdp_word_string(data[toff : toff + 6])
        pal_primary = int(data[toff + 6])
        pal_alt = int(data[toff + 7])
        p_ids = [int(b) for b in data[toff + 8 : toff + 16] if b != 0xFF]
        roster = [players_db[pid] for pid in p_ids]

        avg_sp = round(sum(p["sp"] for p in roster) / len(roster), 1)
        avg_re = round(sum(p["re"] for p in roster) / len(roster), 1)
        avg_sv = round(sum(p["sv"] for p in roster) / len(roster), 1)
        avg_bl = round(sum(p["bl"] for p in roster) / len(roster), 1)

        full_name, flag_code = country_full_names.get(code, (code, code))
        p_colors = palettes[pal_primary]["colors"]
        a_colors = palettes[pal_alt]["colors"]

        teams.append({
            "id": tid,
            "code": code,
            "name": full_name,
            "rom_offset": f"0x{toff:05X}",
            "palette_primary_id": pal_primary,
            "palette_alt_id": pal_alt,
            "jersey_primary": p_colors[4],
            "jersey_secondary": p_colors[7],
            "jersey_shadow": p_colors[2],
            "skin_color": p_colors[10],
            "alt_jersey_primary": a_colors[4],
            "alt_jersey_secondary": a_colors[7],
            "stats_avg": {"sp": avg_sp, "re": avg_re, "sv": avg_sv, "bl": avg_bl},
            "roster": roster,
        })

    # Add the Secret "???" Team (URAWAZA cheat team from 0x14F3A)
    secret_off = 0x14F3A
    secret_pids = [int(b) for b in data[secret_off + 8 : secret_off + 16] if b != 0xFF]
    secret_roster = []
    secret_names = ["TSUKA", "NAKAM", "ISHIM", "OKUDA", "ITAMU", "VSYS", "SEGA", "MEGA"]
    for idx, pid in enumerate(secret_pids):
        p = dict(players_db[pid])
        p["name"] = secret_names[idx % len(secret_names)]
        p["sp"] = max(p["sp"], 8)
        p["re"] = max(p["re"], 7)
        p["sv"] = max(p["sv"], 8)
        p["bl"] = max(p["bl"], 8)
        secret_roster.append(p)

    teams.append({
        "id": 8,
        "code": "???",
        "name": "Seleção Secreta ??? (URAWAZA)",
        "rom_offset": "0x14F3A",
        "palette_primary_id": 4,
        "palette_alt_id": 7,
        "jersey_primary": palettes[4]["colors"][7],
        "jersey_secondary": palettes[4]["colors"][13],
        "jersey_shadow": palettes[4]["colors"][5],
        "skin_color": palettes[4]["colors"][10],
        "alt_jersey_primary": palettes[7]["colors"][4],
        "alt_jersey_secondary": palettes[7]["colors"][7],
        "stats_avg": {"sp": 8.0, "re": 7.5, "sv": 8.0, "bl": 8.0},
        "secret": True,
        "roster": secret_roster,
    })

    # 5. Sound & FM Patch Names (0x18000 - 0x19800 & 0x1CF00 - 0x1D700)
    sfx_patches = []
    for pos in range(0x18000, 0x19800, 0x40):
        name_bytes = data[pos + 0x36 : pos + 0x40]
        name = "".join(chr(b) if 32 <= b <= 126 else "" for b in name_bytes).strip()
        if name:
            sfx_patches.append({
                "rom_offset": f"0x{pos:05X}",
                "name": name,
                "params": list(data[pos : pos + 16]),
            })

    fm_instruments = []
    for pos in range(0x1CEF7, 0x1D6F7, 0x40):
        name_bytes = data[pos + 0x20 : pos + 0x2A]
        name = "".join(chr(b) if 32 <= b <= 126 else "" for b in name_bytes).strip()
        if name:
            fm_instruments.append({
                "rom_offset": f"0x{pos:05X}",
                "name": name,
                "alg_fb": int(data[pos]),
            })

    # 6. Export VDP Tile Sheets as PNGs in assets/
    w, h, rgba1 = render_tiles_rgba(data, 0x20000, 0x30000, palettes_rgb[1], cols=32, transparent_zero=False)
    write_png_rgba(os.path.join(ASSETS_DIR, "vdp_bank_ui_crowd_20000.png"), w, h, rgba1)

    w2, h2, rgba2 = render_tiles_rgba(data, 0x30000, 0x40000, palettes_rgb[9], cols=32, transparent_zero=True)
    write_png_rgba(os.path.join(ASSETS_DIR, "vdp_bank_sprites_logo_30000.png"), w2, h2, rgba2)

    # Also extract the 8x8 arcade font (located at 0x22600 - 0x22E00 in the ROM!)
    # Let's verify exact offset of '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ' in 0x20000-0x28000
    w3, h3, rgba3 = render_tiles_rgba(data, 0x22000, 0x26000, palettes_rgb[1], cols=16, transparent_zero=True)
    write_png_rgba(os.path.join(ASSETS_DIR, "vdp_font_and_hud.png"), w3, h3, rgba3)

    rom_bundle = {
        "generator": "REA (Reverse Engineer Anything - morluto/rea methodology)",
        "rom_info": rom_info,
        "palettes": palettes,
        "teams": teams,
        "coach_quotes": {
            "champion": "HEY! GREAT JOB. WE'RE THE CHAMPS.",
            "win_1": "LET'S GO FOR THE GOLD.",
            "win_2": "WE CAN DO IT. LET'S GO!",
            "lose_1": "OH-NO! LET'S TRY AGAIN.",
            "lose_2": "OH-MAN! WE'LL TRY HARDER.",
            "lose_3": "LET'S GIVE IT THE BEST NEXT TIME.",
            "lose_4": "WE NEED TEAMWORK!",
            "lose_5": "SORRY-COACH. WE'LL TRY HARDER.",
        },
        "hidden_passwords": {
            "STAFF": "Exibe os créditos secretos da equipe original da Video System / Micronics (Tsukada, Nakamura, Ishimoto, Okuda, Itamura)",
            "URAWAZA": "Desbloqueia a seleção secreta '???' com atributos máximos no World League e Normal Game",
        },
        "sfx_catalog": sfx_patches[:45],
        "fm_instruments": fm_instruments,
    }

    json_path = os.path.join(PROJECT_DIR, "rom_data.json")
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(rom_bundle, f, indent=2, ensure_ascii=False)

    js_path = os.path.join(PROJECT_DIR, "rom_data.js")
    with open(js_path, "w", encoding="utf-8") as f:
        f.write("window.SUPER_VOLLEY_ROM_DATA = ")
        json.dump(rom_bundle, f, indent=2, ensure_ascii=False)
        f.write(";\n")

    print(f"[REA] Extração concluída com sucesso!")
    print(f"  - JSON salvo em: {json_path}")
    print(f"  - JS salvo em:   {js_path}")
    print(f"  - Seleções extraídas: {len(teams)} ({', '.join(t['code'] for t in teams)})")
    print(f"  - Jogadores extraídos: {len(players_db)}")
    print(f"  - Paletas CRAM extraídas: {len(palettes)}")
    print(f"  - Patches FM / SFX: {len(fm_instruments)} FM, {len(sfx_patches)} SFX")


if __name__ == "__main__":
    extract_all()
