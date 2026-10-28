import {tr,useUiLanguage,uiLocale} from '../i18n';
import {BADGES,type Badge} from '../../shared/challenges';
export default function BuildBadges({badges}:{badges:Badge[]}){
  useUiLanguage();
 if(!badges.length)return null;
 return <section className="px-3 py-2 space-y-2" aria-label={tr("Your builder badges")}><p className="text-xs text-on-surface-variant">{tr("Builder badges")}</p><ul className="flex flex-wrap gap-1.5">{badges.map(badge=><li key={badge.key} title={tr("Earned {{0}}",new Date(badge.earnedAt).toLocaleDateString(uiLocale()))} className="rounded-lg bg-primary-container text-on-primary-container text-xs px-2 py-1 break-words">{tr(BADGES[badge.key])}</li>)}</ul></section>;
}
