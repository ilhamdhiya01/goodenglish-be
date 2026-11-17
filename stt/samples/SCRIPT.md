# Rekaman uji (suara asli)

Klip sintetis di `synthetic/` memakai suara mesin macOS, bukan aksen
Indonesia. Untuk mengukur akurasi yang sebenarnya, rekam 15 klip di bawah
dengan suaramu (atau suara pelajar), lalu jalankan `bench.py --dir samples/real`.

## Cara merekam
- Pakai HP atau laptop, di ruangan biasa (bukan studio). Bicara wajar, jangan
  dibuat-buat. Kesalahan grammar di kalimat **sengaja**: ucapkan persis.
- Format apa saja yang bisa dibuka ffmpeg: m4a (Voice Memos / perekam HP),
  webm, ogg, mp3, wav.
- Simpan dengan nama file seperti di tabel, di folder `samples/real/`.
- `expected.json` sudah ada di `samples/real/`. Ubah kolom `file` kalau
  ekstensinya beda (mis. `.mp3`).

| File | Bahasa | Jenis | Ucapkan |
|---|---|---|---|
| r01_short_en.m4a | en | pendek | "Yes, please." |
| r02_short_en.m4a | en | pendek | "Two coffee." |
| r03_grammar.m4a | en | grammar salah | "I go to event yesterday." |
| r04_grammar.m4a | en | grammar salah | "Yesterday I am meet my friend." |
| r05_grammar.m4a | en | grammar salah | "She is work in Jakarta since two years." |
| r06_grammar.m4a | en | grammar salah | "He don't like coffee." |
| r07_grammar.m4a | en | grammar salah | "I want buy two latte. How much it is?" |
| r08_long_en.m4a | en | panjang (±10 dtk) | "Hi, my name is Rani. I am from Jakarta and I work as a developer in a small startup. I have been living here for three years and I really like the food." |
| r09_long_grammar.m4a | en | panjang + salah | "Last week I go to Bali with my family. We stay in hotel near the beach, and the weather is very hot, but we very happy." |
| r10_hesitant.m4a | en | ragu-ragu | "Umm... I am... I am work as, uh, teacher." |
| r11_short_id.m4a | id | pendek | "Iya, boleh." |
| r12_long_id.m4a | id | panjang | "Aku kerja di Jakarta sudah dua tahun, biasanya aku naik kereta ke kantor." |
| r13_silence.m4a | en | hening | (rekam 5 detik tanpa bicara) |
| r14_noise.m4a | en | noise | (5 detik di tempat ramai / kipas angin, tanpa bicara) |
| r15_noisy_speech.m4a | en | bicara + noise | "I go to event yesterday with my friend." (sambil ada suara latar) |
