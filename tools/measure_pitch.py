"""Prepara capturas do FM23 (2D ou posições médias) para medição.

Acha o campo pelas linhas brancas (linhas de fundo = colunas brancas mais externas; laterais = linhas brancas
mais externas), desenha uma grade de 10% por cima e marca o centro de anéis vermelhos de destaque, se houver.
A leitura das posições é feita na imagem anotada: u = 0..100 ao longo do comprimento (da esquerda para a
direita da imagem), v = 0..100 na largura (de cima para baixo).

Conversão para as coordenadas do site (y = 0 no nosso gol, x = 0 na nossa esquerda):
  atacando para a direita da imagem:  y = u,       x = v
  atacando para a esquerda da imagem: y = 100 - u, x = 100 - v

Uso: python3 tools/measure_pitch.py <imagem ou pasta> <pasta de saída>
Gera <nome>.jpg anotado e medidas.json com o retângulo do campo e os anéis encontrados.
Requer Pillow e numpy.
"""
import json
import os
import sys
from collections import deque

import numpy as np
from PIL import Image, ImageDraw


def components(mask, min_area, max_area):
    h, w = mask.shape
    seen = np.zeros_like(mask, dtype=bool)
    out = []
    ys, xs = np.nonzero(mask)
    for y0, x0 in zip(ys, xs):
        if seen[y0, x0]:
            continue
        q = deque([(y0, x0)])
        seen[y0, x0] = True
        pts = []
        while q:
            y, x = q.popleft()
            pts.append((y, x))
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    ny, nx = y + dy, x + dx
                    if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not seen[ny, nx]:
                        seen[ny, nx] = True
                        q.append((ny, nx))
        if min_area <= len(pts) <= max_area:
            a = np.array(pts)
            out.append({'y': float((a[:, 0].min() + a[:, 0].max()) / 2), 'x': float((a[:, 1].min() + a[:, 1].max()) / 2),
                        'area': len(pts), 'h': int(np.ptp(a[:, 0]) + 1), 'w': int(np.ptp(a[:, 1]) + 1)})
    return out


def analyse(path):
    im = Image.open(path).convert('RGB')
    rgb = np.asarray(im)
    H0, W0 = rgb.shape[:2]
    r, g, b = (rgb[..., i].astype(int) for i in range(3))
    white = (r > 160) & (g > 160) & (b > 160)
    vc = np.nonzero(white.mean(0) > 0.5)[0]
    hr = np.nonzero(white.mean(1) > 0.5)[0]
    okx = len(vc) >= 2 and vc[-1] - vc[0] > W0 * 0.5
    oky = len(hr) >= 2 and hr[-1] - hr[0] > H0 * 0.5
    L, R = (int(vc[0]), int(vc[-1])) if okx else (0, W0 - 1)
    T, B = (int(hr[0]), int(hr[-1])) if oky else (0, H0 - 1)
    W, Hh = max(R - L, 1), max(B - T, 1)
    ring = (r > 190) & (g > 50) & (g < 110) & (b > 35) & (b < 110) & (r > g + 100)
    rings = [c for c in components(ring, 40, 50000) if c['w'] > 18 and c['h'] > 18 and c['area'] < 0.6 * c['w'] * c['h']]
    res = {'file': os.path.basename(path), 'box': [L, T, R, B], 'cut': {'comprimento': not okx, 'largura': not oky},
           'aneis': [{'u': round((c['x'] - L) / W * 100, 1), 'v': round((c['y'] - T) / Hh * 100, 1)} for c in rings]}
    d = ImageDraw.Draw(im)
    for k in range(11):
        x = L + W * k / 10
        d.line([(x, T), (x, B)], fill=(255, 255, 0), width=max(1, im.width // 600))
        d.text((x + 3, T + 3), str(k * 10), fill=(255, 255, 0))
        y = T + Hh * k / 10
        d.line([(L, y), (R, y)], fill=(0, 255, 255), width=1)
        d.text((L + 3, y + 2), str(k * 10), fill=(0, 255, 255))
    return res, im


if __name__ == '__main__':
    src, dst = sys.argv[1], sys.argv[2]
    os.makedirs(dst, exist_ok=True)
    files = [src] if os.path.isfile(src) else [os.path.join(src, f) for f in sorted(os.listdir(src)) if f.lower().endswith(('.png', '.jpg', '.jpeg'))]
    out = []
    for f in files:
        res, im = analyse(f)
        im.thumbnail((1200, 1200))
        im.save(os.path.join(dst, os.path.splitext(os.path.basename(f))[0] + '.jpg'), quality=85)
        out.append(res)
    json.dump(out, open(os.path.join(dst, 'medidas.json'), 'w'), indent=1, ensure_ascii=False)
    print(len(out), 'imagens ->', dst)
