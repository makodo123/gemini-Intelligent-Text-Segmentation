import { TranscriptSegment } from "../types";

/**
 * 分段模式
 */
export enum SplitMode {
  SENTENCE = 'sentence',      // 按句子分段（标点符号）
  TIME = 'time',              // 按时间分段
  CHARACTER = 'character',    // 按字数分段
  SEMANTIC = 'semantic'       // 智能语义分段
}

/**
 * 分段选项
 */
export interface SplitOptions {
  mode: SplitMode;
  maxDuration?: number;       // 最大时长（秒）
  maxCharacters?: number;     // 最大字数
  minCharacters?: number;     // 最小字数
  preserveSpeaker?: boolean;  // 保持说话者连续性
}

/**
 * 改进的智能分段算法
 * 支持多种分段模式和更精确的时间戳插值
 */
export const advancedSplitSegments = (
  segments: TranscriptSegment[],
  options: SplitOptions
): TranscriptSegment[] => {
  switch (options.mode) {
    case SplitMode.SENTENCE:
      return splitBySentence(segments, options);
    case SplitMode.TIME:
      return splitByTime(segments, options);
    case SplitMode.CHARACTER:
      return splitByCharacter(segments, options);
    case SplitMode.SEMANTIC:
      return splitBySemantic(segments, options);
    default:
      return segments;
  }
};

/**
 * 按句子分段（改进版）
 */
const splitBySentence = (
  segments: TranscriptSegment[],
  options: SplitOptions
): TranscriptSegment[] => {
  const newSegments: TranscriptSegment[] = [];
  const { minCharacters = 5, preserveSpeaker = true } = options;

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    const text = segment.text.trim();

    // 跳过太短的文本
    if (text.length < minCharacters) {
      newSegments.push(segment);
      continue;
    }

    // 检查是否包含句子终止符
    if (!/[。！？?!；;]/.test(text)) {
      newSegments.push(segment);
      continue;
    }

    // 计算持续时间
    const duration = calculateDuration(segment, segments[i + 1], text);

    // 更智能的分割：保留标点符号
    const parts = text.split(/([。！？?!；;])/g).reduce((acc, curr, idx, arr) => {
      if (idx % 2 === 0 && curr.trim()) {
        // 文本部分
        const punctuation = arr[idx + 1] || '';
        acc.push(curr.trim() + punctuation);
      }
      return acc;
    }, [] as string[]);

    if (parts.length <= 1) {
      newSegments.push(segment);
      continue;
    }

    // 基于字数比例插值时间戳
    let currentOffset = 0;
    const totalChars = text.length;

    parts.forEach((part, partIndex) => {
      if (!part.trim()) return;
      
      const partRatio = part.length / totalChars;
      const partDuration = duration * partRatio;
      const newStartTime = segment.startTimeSeconds + currentOffset;
      
      newSegments.push({
        speaker: segment.speaker,
        timestamp: formatTime(newStartTime),
        startTimeSeconds: newStartTime,
        text: part.trim()
      });

      currentOffset += partDuration;
    });
  }

  return newSegments;
};

/**
 * 按时间分段
 */
const splitByTime = (
  segments: TranscriptSegment[],
  options: SplitOptions
): TranscriptSegment[] => {
  const { maxDuration = 30, preserveSpeaker = true } = options;
  const newSegments: TranscriptSegment[] = [];
  
  let currentBatch: TranscriptSegment[] = [];
  let batchStartTime = 0;
  let batchDuration = 0;

  segments.forEach((segment, index) => {
    const segmentDuration = calculateDuration(segment, segments[index + 1], segment.text);
    
    // 检查是否需要开始新批次
    const shouldStartNew = 
      batchDuration + segmentDuration > maxDuration ||
      (preserveSpeaker && currentBatch.length > 0 && currentBatch[0].speaker !== segment.speaker);

    if (shouldStartNew && currentBatch.length > 0) {
      // 合并当前批次
      newSegments.push(mergeBatch(currentBatch, batchStartTime));
      currentBatch = [];
      batchDuration = 0;
    }

    if (currentBatch.length === 0) {
      batchStartTime = segment.startTimeSeconds;
    }

    currentBatch.push(segment);
    batchDuration += segmentDuration;
  });

  // 处理最后一批
  if (currentBatch.length > 0) {
    newSegments.push(mergeBatch(currentBatch, batchStartTime));
  }

  return newSegments;
};

/**
 * 按字数分段
 */
const splitByCharacter = (
  segments: TranscriptSegment[],
  options: SplitOptions
): TranscriptSegment[] => {
  const { maxCharacters = 100, minCharacters = 20, preserveSpeaker = true } = options;
  const newSegments: TranscriptSegment[] = [];
  
  let currentBatch: TranscriptSegment[] = [];
  let batchStartTime = 0;
  let batchCharCount = 0;

  segments.forEach((segment, index) => {
    const segmentCharCount = segment.text.length;
    
    // 检查是否需要开始新批次
    const shouldStartNew = 
      batchCharCount + segmentCharCount > maxCharacters ||
      (preserveSpeaker && currentBatch.length > 0 && currentBatch[0].speaker !== segment.speaker);

    if (shouldStartNew && currentBatch.length > 0 && batchCharCount >= minCharacters) {
      newSegments.push(mergeBatch(currentBatch, batchStartTime));
      currentBatch = [];
      batchCharCount = 0;
    }

    if (currentBatch.length === 0) {
      batchStartTime = segment.startTimeSeconds;
    }

    currentBatch.push(segment);
    batchCharCount += segmentCharCount;
  });

  // 处理最后一批
  if (currentBatch.length > 0) {
    newSegments.push(mergeBatch(currentBatch, batchStartTime));
  }

  return newSegments;
};

/**
 * 智能语义分段（结合多种策略）
 */
const splitBySemantic = (
  segments: TranscriptSegment[],
  options: SplitOptions
): TranscriptSegment[] => {
  // 首先按句子分段
  let result = splitBySentence(segments, options);
  
  // 然后应用时间和字数约束
  const timeOptions = { ...options, mode: SplitMode.TIME, maxDuration: options.maxDuration || 30 };
  result = splitByTime(result, timeOptions);
  
  return result;
};

/**
 * 计算片段持续时间
 */
const calculateDuration = (
  segment: TranscriptSegment,
  nextSegment: TranscriptSegment | undefined,
  text: string
): number => {
  if (nextSegment) {
    const duration = nextSegment.startTimeSeconds - segment.startTimeSeconds;
    // 合理性检查
    if (duration > 0 && duration <= 60) {
      return duration;
    }
  }
  
  // 估算：中文约 0.25 秒/字，英文约 0.05 秒/字符
  const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  const otherChars = text.length - chineseChars;
  return chineseChars * 0.25 + otherChars * 0.05;
};

/**
 * 合并批次为单个片段
 */
const mergeBatch = (
  batch: TranscriptSegment[],
  startTime: number
): TranscriptSegment => {
  const text = batch.map(s => s.text).join(' ');
  const speaker = batch[0].speaker;
  
  return {
    speaker,
    timestamp: formatTime(startTime),
    startTimeSeconds: startTime,
    text
  };
};

/**
 * 格式化时间为 MM:SS 或 HH:MM:SS
 */
const formatTime = (seconds: number): string => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  
  const mStr = m.toString().padStart(2, '0');
  const sStr = s.toString().padStart(2, '0');
  
  if (h > 0) {
    return `${h}:${mStr}:${sStr}`;
  }
  return `${mStr}:${sStr}`;
};
