import { createHash } from 'crypto';

/**
 * デバイスIDから4バイト（32ビット）のハッシュを生成
 * 親機IDハッシュとして起床信号・データパケットに含める
 *
 * @param {string} deviceId - 親機デバイスID（例: "foxsense-001"）
 * @returns {number} 4バイトハッシュ値（0x00000000 - 0xFFFFFFFF）
 */
export const computeParentIdHash = (deviceId) => {
  const hash = createHash('sha256').update(deviceId).digest();
  // 先頭4バイトを32ビット符号なし整数として取得
  return hash.readUInt32BE(0);
};

/**
 * 4バイトハッシュを16進数文字列に変換
 *
 * @param {number} hash - 4バイトハッシュ値
 * @returns {string} 8桁16進数文字列（例: "a1b2c3d4"）
 */
export const hashToHex = (hash) => {
  return (hash >>> 0).toString(16).padStart(8, '0');
};
