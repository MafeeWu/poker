import { useEffect, useState } from 'react';
import { HomePage } from '../features/home/HomePage';
import { RoomPage } from '../features/room/RoomPage';

export function AppRouter() {
  const [pathname, setPathname] = useState(window.location.pathname);

  useEffect(() => {
    const updatePath = () => setPathname(window.location.pathname);
    window.addEventListener('popstate', updatePath);
    return () => window.removeEventListener('popstate', updatePath);
  }, []);

  const roomMatch = pathname.match(/^\/room\/([^/]+)$/);

  if (roomMatch) {
    return <RoomPage roomCode={roomMatch[1]} />;
  }

  return <HomePage />;
}
