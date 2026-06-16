import { useEffect, useRef, useState } from 'react';
import { BOARD_PAGE_SIZE } from '../constants/options';
import { getResponsiveMasonryColumnCount } from '../lib/board';

export const useBoard = () => {
  const [boardVisibleCount, setBoardVisibleCount] = useState(BOARD_PAGE_SIZE);
  const [boardLoadingMore, setBoardLoadingMore] = useState(false);
  const [masonryColumnCount, setMasonryColumnCount] = useState(getResponsiveMasonryColumnCount);
  const boardRef = useRef(null);
  const boardLoadSentinelRef = useRef(null);

  useEffect(() => {
    const updateColumnCount = () => setMasonryColumnCount(getResponsiveMasonryColumnCount());
    updateColumnCount();
    window.addEventListener('resize', updateColumnCount);
    return () => window.removeEventListener('resize', updateColumnCount);
  }, []);

  return {
    boardVisibleCount,
    setBoardVisibleCount,
    boardLoadingMore,
    setBoardLoadingMore,
    masonryColumnCount,
    boardRef,
    boardLoadSentinelRef,
  };
};