export const characters = [
  { id: 'community', name: '阶跃娘', label: '社区形象', kind: 'character' },
  { id: 'official-early', name: '早期官方阶跃娘', label: '早期形象', kind: 'character' },
  { id: 'amoo', name: 'Amoo', label: '角色', kind: 'character' },
  { id: 'duck-bike', name: '快蹬鸭', label: '载具', kind: 'vehicle' },
];

export const outfits = [
  { id: 'origin', characterId: 'community', name: '原点' },
  { id: 'tiangong', characterId: 'community', name: '天工开物' },
  { id: 'skyline', characterId: 'community', name: '天际线' },
];

export const referenceKinds = [
  { id: 'fullbody', name: '立绘' },
  { id: 'detail', name: '细节参考' },
  { id: 'artwork', name: '相关作品' },
];

export function characterMetadata(entry) {
  const characterId = entry?.characterId ?? '';
  const relatedCharacterIds = entry?.relatedCharacterIds === undefined ? [] : entry.relatedCharacterIds;
  const outfitIds = entry?.outfitIds ?? [];
  const referenceKind = entry?.referenceKind ?? '';
  const detailLabel = entry?.detailLabel ?? '';
  if (typeof characterId !== 'string' || (characterId && !characters.some((item) => item.id === characterId))) {
    throw new Error('请选择有效档案');
  }
  if (!Array.isArray(relatedCharacterIds) || relatedCharacterIds.length >= characters.length
    || new Set(relatedCharacterIds).size !== relatedCharacterIds.length
    || relatedCharacterIds.some((id) => typeof id !== 'string' || id === characterId
      || id === 'official-early' || !characters.some((item) => item.id === id))
    || (relatedCharacterIds.length && (!characterId || characterId === 'official-early'))) {
    throw new Error('关联档案不存在、重复或与主要档案冲突；早期官方档案须独立收录');
  }
  if (!Array.isArray(outfitIds) || outfitIds.length > outfits.length
    || new Set(outfitIds).size !== outfitIds.length
    || outfitIds.some((id) => typeof id !== 'string'
      || !outfits.some((item) => item.id === id && item.characterId === characterId))) {
    throw new Error('套装不存在、重复或不属于所选形象');
  }
  if (typeof referenceKind !== 'string' || (referenceKind && !referenceKinds.some((item) => item.id === referenceKind))
    || (referenceKind && !characterId)) throw new Error('参考类型需要关联有效主要档案');
  if (typeof detailLabel !== 'string' || /[\u0000-\u001f\u007f]/.test(detailLabel)
    || [...detailLabel].length > 60 || (detailLabel.trim() && referenceKind !== 'detail')) {
    throw new Error('细节部位仅用于细节参考，最多 60 字');
  }
  return { characterId, relatedCharacterIds: [...relatedCharacterIds], outfitIds: [...outfitIds], referenceKind, detailLabel: detailLabel.trim() };
}

export function inCharacterScope(item, characterId, outfitId = '') {
  if (!characterId || !characters.some((entry) => entry.id === characterId)) return false;
  if (outfitId) return item.characterId === characterId && item.outfitIds?.includes(outfitId) === true;
  if (characterId === 'official-early' || item.characterId === 'official-early') return item.characterId === characterId;
  return item.characterId === characterId || item.relatedCharacterIds?.includes(characterId) === true;
}

// Secondary associations are related works, never this archive's own reference sheets.
export function isArchiveReference(item, characterId, outfitId = '') {
  return item.characterId === characterId && ['fullbody', 'detail'].includes(item.referenceKind)
    && (outfitId ? item.outfitIds?.includes(outfitId) === true : !item.outfitIds?.length);
}
