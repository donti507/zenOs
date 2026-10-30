import {useEffect,useState} from 'react';
import {Link,useNavigate} from 'react-router-dom';
import {useZenos} from '../context/ZenosContext';
import {tr,useUiLanguage} from '../i18n';
import {usosError} from '../../shared/usos';
import {btn,card} from '../components/ui/kit';
export default function UsosReturn(){
 useUiLanguage();const {finishUsosLogin}=useZenos(),navigate=useNavigate();
 const [fragment]=useState(()=>window.location.hash),[error,setError]=useState('');
 useEffect(()=>{let active=true;window.history.replaceState(window.history.state,'',window.location.pathname);
  void finishUsosLogin(fragment).then(()=>{if(active)navigate('/',{replace:true});}).catch(error=>{if(active)setError(error instanceof Error?error.message:usosError('unavailable'));});
  return()=>{active=false;};
 },[fragment,finishUsosLogin,navigate]);
 return <main className="min-h-dvh bg-surface text-on-surface flex items-center justify-center p-4"><section className={card+' p-6 space-y-4 w-full max-w-md'}><h1 className="text-xl font-semibold">{tr('USOS university sign-in')}</h1>{error?<><p role="alert" className="text-error">{tr(error)}</p><Link to="/login" replace className={btn.primary}>{tr('Back to sign in')}</Link></>:<p role="status" aria-live="polite" className="text-on-surface-variant">{tr('Completing USOS sign-in…')}</p>}</section></main>;
}
