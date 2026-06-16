import { saveHistory } from './history';

export const patchImageInHistory = (history, image, patch, isSameImage) => (history || []).map((record) => ({
  ...record,
  images: (record.images || []).map((item) => (isSameImage(item, image) ? { ...item, ...patch } : item)),
}));

export const setHistoryWithPatch = (setHistory, image, patch, isSameImage) => {
  setHistory((items) => {
    const nextHistory = patchImageInHistory(items, image, patch, isSameImage);
    saveHistory(nextHistory);
    return nextHistory;
  });
};

export const patchSelectedImage = (setSelectedImage, image, patch, isSameImage) => {
  setSelectedImage((current) => (current && isSameImage(current, image) ? { ...current, ...patch } : current));
};

export const patchImagesList = (setImages, image, patch, isSameImage) => {
  setImages((items) => items.map((item) => (isSameImage(item, image) ? { ...item, ...patch } : item)));
};

export const applyWallPatch = ({ setImages, setHistory, setSelectedImage }, image, patch, isSameImage) => {
  patchImagesList(setImages, image, patch, isSameImage);
  setHistoryWithPatch(setHistory, image, patch, isSameImage);
  patchSelectedImage(setSelectedImage, image, patch, isSameImage);
};