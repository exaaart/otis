import { buildToothData, buildToothPart, buildPulpPart } from './tooth-sdf.js';

// Строим модель в фоне, чтобы не блокировать прокрутку и анимацию страницы.
// Поддерживает раздельную сборку: сначала только зуб, пульпа — по запросу (в режиме «Внутри»).
self.onmessage = (e) => {
  const { quality = 'high', part = 'both' } = e.data || {};
  const transfer = [];
  const collect = (mesh) => {
    for (const arr of Object.values(mesh)) transfer.push(arr.buffer);
  };

  if (part === 'tooth') {
    const tooth = buildToothPart({ quality });
    collect(tooth);
    self.postMessage({ tooth }, transfer);
    return;
  }
  if (part === 'pulp') {
    const pulp = buildPulpPart({ quality });
    collect(pulp);
    self.postMessage({ pulp }, transfer);
    return;
  }

  const data = buildToothData({ quality });
  collect(data.tooth);
  collect(data.pulp);
  self.postMessage(data, transfer);
};
