import { Factory, Move3D } from 'lucide-react';
export function StudioNav({ active }: { active: 'robot' | 'line' }) {
  return (
    <nav className="studio-nav" aria-label="シミュレーター切り替え">
      <a href="#robot" aria-current={active === 'robot' ? 'page' : undefined}>
        <Move3D size={14} />
        ロボット軌道
      </a>
      <a href="#line" aria-current={active === 'line' ? 'page' : undefined}>
        <Factory size={14} />
        製造ライン
      </a>
    </nav>
  );
}
