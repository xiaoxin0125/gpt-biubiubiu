import { defaultApiConfigItem } from '../constants/options';
import { requestJson } from '../lib/api';
import { isSameImageIdentity } from '../lib/board';
import { normalizeRevisedPrompt } from '../lib/form';
import { createImageSrc, getGeneratedImageJobId, normalizeImageSource } from '../lib/images';
import { applyWallPatch } from '../lib/optimistic';

export const findWallItem = (wallItems, image) => {
  if (!image) return null;
  if (image.wallItemId) {
    const matched = wallItems.find((item) => Number(item.id) === Number(image.wallItemId));
    if (matched) return matched;
    if (image.isOnWall) return { id: image.wallItemId };
    return null;
  }

  const src = createImageSrc(image);
  return wallItems.find((item) => {
    const wallSrc = createImageSrc(item);
    return src && wallSrc && src === wallSrc;
  }) || null;
};

export const useWall = (deps) => {
  const {
    wallItems,
    setWallItems,
    user,
    form,
    activeApiConfig,
    status,
    getElapsedSeconds,
    setImages,
    setHistory,
    setSelectedImage,
    setWallBusyId,
    setError,
  } = deps;

  const isSameImage = isSameImageIdentity;

  const matchWallItem = (image) => findWallItem(wallItems, image);

  const clearWallState = (image) => {
    applyWallPatch({ setImages, setHistory, setSelectedImage }, image, { wallItemId: null, isOnWall: false }, isSameImage);
  };

  const checkWallState = async (image) => {
    const wallItem = matchWallItem(image);
    if (!wallItem?.id) {
      clearWallState(image);
      setError('本地上墙状态已清理，可重新上墙。');
      return;
    }

    const busyId = String(image.wallItemId || image.id || createImageSrc(image));
    setWallBusyId(busyId);
    try {
      const data = await requestJson(`/api/wall/${wallItem.id}`);
      if (data.item) {
        setWallItems((items) => [data.item, ...items.filter((item) => Number(item.id) !== Number(data.item.id))]);
        setSelectedImage((current) => (current && isSameImage(current, image) ? { ...current, wallItemId: data.item.id, isOnWall: true } : current));
        setError('作品仍在墙上。');
      }
    } catch {
      setWallItems((items) => items.filter((item) => Number(item.id) !== Number(wallItem.id)));
      clearWallState(image);
      setError('服务器未找到该上墙作品，可重新上墙。');
    } finally {
      setWallBusyId('');
    }
  };

  const toggleWall = async (image) => {
    const wallItem = matchWallItem(image);
    const busyId = String(image.wallItemId || image.id || createImageSrc(image));
    setWallBusyId(busyId);
    setError('');

    try {
      if (!user) throw new Error('请先登录后再操作上墙。');

      if (wallItem?.id) {
        const ownerId = image.userId || image.user_id || wallItem.userId || wallItem.user_id;
        if (!user.isAdmin && ownerId && Number(ownerId) !== Number(user.id)) throw new Error('只能取消自己上墙的作品。');
        await requestJson(`/api/wall/${wallItem.id}`, { method: 'DELETE' });

        setWallItems((items) => items.filter((item) => Number(item.id) !== Number(wallItem.id)));
        applyWallPatch({ setImages, setHistory, setSelectedImage }, image, { wallItemId: null, isOnWall: false }, isSameImage);
        return;
      }

      const sourceJobId = getGeneratedImageJobId(image);
      if (!sourceJobId) throw new Error('请等待作品保存到服务器后再上墙。');

      const wallForm = { ...(image.form || form), apiName: image.apiName || activeApiConfig?.apiName || status.apiName || defaultApiConfigItem.apiName, source: normalizeImageSource(image.source), sourceJobId };
      const data = await requestJson('/api/wall', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: image.prompt || image.form?.prompt || form.prompt,
          revised_prompt: normalizeRevisedPrompt(image.revised_prompt),
          durationSeconds: getElapsedSeconds(image),
          sourceJobId,
          form: wallForm,
          params: { ...wallForm, durationSeconds: getElapsedSeconds(image) },
        }),
      });

      const nextWallItem = data.item;
      setWallItems((items) => [nextWallItem, ...items.filter((item) => Number(item.id) !== Number(nextWallItem.id))]);
      applyWallPatch({ setImages, setHistory, setSelectedImage }, image, { wallItemId: nextWallItem.id, isOnWall: true, userId: nextWallItem.userId }, isSameImage);
    } catch (wallError) {
      setError(wallError instanceof Error ? wallError.message : '作品墙操作失败');
    } finally {
      setWallBusyId('');
    }
  };

  return { clearWallState, checkWallState, toggleWall };
};