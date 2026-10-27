import {BADGES,type Badge} from '../../shared/challenges';
export default function BuildBadges({badges}:{badges:Badge[]}){
 if(!badges.length)return null;
 return <section className="px-3 py-2 space-y-2" aria-label="Your builder badges"><p className="text-xs text-on-surface-variant">Builder badges</p><ul className="flex flex-wrap gap-1.5">{badges.map(badge=><li key={badge.key} title={`Earned ${new Date(badge.earnedAt).toLocaleDateString()}`} className="rounded-lg bg-primary-container text-on-primary-container text-xs px-2 py-1 break-words">{BADGES[badge.key]}</li>)}</ul></section>;
}
