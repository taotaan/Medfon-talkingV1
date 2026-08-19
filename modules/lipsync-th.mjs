/**
* @class Thai lip-sync processor
*/

class LipsyncTh {

  constructor() {
    this.visemes = {
      'ก': 'kk', 'ข': 'kk', 'ค': 'kk', 'ฆ': 'kk',
      'จ': 'CH', 'ฉ': 'CH', 'ช': 'CH', 'ฌ': 'CH',
      'ซ': 'SS', 'ศ': 'SS', 'ษ': 'SS', 'ส': 'SS',
      'ด': 'DD', 'ฎ': 'DD', 'ต': 'DD', 'ฏ': 'DD', 'ถ': 'TH', 'ฐ': 'TH', 'ท': 'TH', 'ฑ': 'TH', 'ฒ': 'TH', 'ธ': 'TH',
      'บ': 'PP', 'ป': 'PP', 'ผ': 'FF', 'พ': 'PP', 'ภ': 'PP', 'ฝ': 'FF', 'ฟ': 'FF',
      'ม': 'PP', 'น': 'nn', 'ณ': 'nn', 'ง': 'nn', 'ญ': 'nn', 'ย': 'I', 'ร': 'RR', 'ล': 'nn', 'ฬ': 'nn', 'ว': 'U',
      'ห': 'aa', 'อ': 'aa', 'ฮ': 'aa',
      'ะ': 'aa', 'ั': 'aa', 'า': 'aa', 'ำ': 'aa', 'ิ': 'I', 'ี': 'I', 'ึ': 'I', 'ื': 'I',
      'ุ': 'U', 'ู': 'U', 'เ': 'E', 'แ': 'E', 'โ': 'O', 'ใ': 'aa', 'ไ': 'aa', 'ๅ': 'aa'
    };
    this.visemeDurations = {
      aa: 1.2, E: 1, I: 0.9, O: 1.1, U: 1, PP: 0.8, SS: 0.9, TH: 0.9,
      DD: 0.8, FF: 0.9, kk: 0.8, nn: 0.8, RR: 0.8, CH: 0.9, sil: 0.5
    };
    this.specialDurations = { ' ': 0.8, '.': 1.2, ',': 1.0, '!': 1.2, '?': 1.2 };
  }

  preProcessText(s) {
    return s.replace(/[#_*'":;]/g,'')
      .replace(/[ๆฯ]/g,'')
      .replace(/[่้๊๋์]/g,'')
      .replace(/\s+/g,' ')
      .trim();
  }

  wordsToVisemes(w) {
    let o = { words: w, visemes: [], times: [], durations: [] };
    let t = 0;

    for ( const ch of [...w] ) {
      const viseme = this.visemes[ch];
      if ( viseme ) {
        const d = this.visemeDurations[viseme] || 1;
        if ( o.visemes.length && o.visemes[o.visemes.length - 1] === viseme ) {
          o.durations[o.durations.length - 1] += d * 0.7;
        } else {
          o.visemes.push(viseme);
          o.times.push(t);
          o.durations.push(d);
        }
        t += d;
      } else {
        t += this.specialDurations[ch] || 0.2;
      }
    }

    return o;
  }
}

export { LipsyncTh };
