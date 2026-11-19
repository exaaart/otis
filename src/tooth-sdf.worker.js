import { buildToothData } from './tooth-sdf.js';

// Строим модель в фоне, чтобы не блокировать прокрутку и анимацию страницы.
self.onmessage = (e) => {
  const data = buildToothData(e.data || {});
  const transfer = [];
  for (const part of [data.tooth, data.pulp]) for (const arr of Object.values(part)) transfer.push(arr.buffer);
  self.postMessage(data, transfer);
};
