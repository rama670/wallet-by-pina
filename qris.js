(function (root, factory) {
  const qris = factory();
  if (typeof module === 'object' && module.exports) module.exports = qris;
  else root.WalletQRIS = qris;
})(globalThis, function () {
  function readFields(payload) {
    const fields = new Map();
    for (let offset = 0; offset < payload.length;) {
      if (offset + 4 > payload.length) return null;
      const tag = payload.slice(offset, offset + 2);
      const lengthText = payload.slice(offset + 2, offset + 4);
      if (!/^\d{2}$/.test(tag) || !/^\d{2}$/.test(lengthText)) return null;
      if (fields.has(tag)) return null;
      const length = Number(lengthText);
      const end = offset + 4 + length;
      if (end > payload.length) return null;
      fields.set(tag, payload.slice(offset + 4, end));
      offset = end;
    }
    return fields;
  }

  function crc16(value) {
    let crc = 0xffff;
    for (const character of value) {
      crc ^= character.charCodeAt(0) << 8;
      for (let bit = 0; bit < 8; bit++) {
        crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1;
        crc &= 0xffff;
      }
    }
    return crc.toString(16).toUpperCase().padStart(4, '0');
  }

  function parseQRIS(payload) {
    if (typeof payload !== 'string' || payload.length < 16 || /[^\x20-\x7e]/.test(payload)) return null;
    const crcOffset = payload.length - 8;
    const crcField = payload.slice(crcOffset);
    if (!/^6304[0-9A-Fa-f]{4}$/.test(crcField) || crc16(payload.slice(0, crcOffset + 4)) !== crcField.slice(4).toUpperCase()) return null;

    const fields = readFields(payload.slice(0, crcOffset));
    if (!fields || fields.get('00') !== '01' || fields.get('53') !== '360' || fields.get('58') !== 'ID') return null;
    const isQris = [...fields.entries()].some(([tag, value]) => Number(tag) >= 26 && Number(tag) <= 51 && value.toUpperCase().includes('ID.CO.QRIS'));
    if (!isQris) return null;

    const merchant = (fields.get('59') || '').trim().slice(0, 50);
    const amountText = fields.get('54');
    let amount;
    if (amountText !== undefined && /^\d+(?:\.\d{1,2})?$/.test(amountText)) {
      const rupiah = Number(amountText);
      if (Number.isSafeInteger(rupiah) && rupiah > 0) amount = rupiah;
    }
    return { merchant, ...(amount === undefined ? {} : { amount }) };
  }

  return { parseQRIS };
});
