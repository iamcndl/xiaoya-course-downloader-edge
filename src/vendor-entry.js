import CryptoJS from 'crypto-js';
import {unzipSync} from 'fflate';
export function decodeUrl(encrypted) {
  try {
    const text = encrypted.replace(/_/g,'+').replace(/\*/g,'/').replace(/-/g,'=');
    const output = CryptoJS.DES.decrypt({ciphertext:CryptoJS.enc.Base64.parse(text)},CryptoJS.enc.Utf8.parse('94374647'),
      {iv:CryptoJS.enc.Utf8.parse('99526255'),mode:CryptoJS.mode.CBC,padding:CryptoJS.pad.Pkcs7});
    const url = output.toString(CryptoJS.enc.Utf8);
    if (!url.startsWith('https://')) throw new Error();
    return url;
  } catch { throw new Error('文件地址解码失败，平台接口可能已变更。'); }
}
export {unzipSync};
