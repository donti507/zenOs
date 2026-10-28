import {recapSpeech,type WeeklyRecap} from '../../shared/weeklyRecaps';
import {getUiLanguage,tr,uiLocale,quantity} from './index';
export function localizedRecapDay(day:string){return new Date(day+'T12:00:00').toLocaleDateString(uiLocale(),{weekday:'long'});}
export function localizedRecapSpeech(recap:WeeklyRecap){
 if(getUiLanguage()==='en')return recapSpeech(recap);
 const best=recap.bestDay?`Najlepszy dzień: ${localizedRecapDay(recap.bestDay)}. Liczba ukończonych zadań: ${recap.bestDayCount}.`:'Nie ma jeszcze najlepszego dnia, ponieważ nie odnotowano ukończonych zadań.';
 const slipped=recap.slippedCount?`Zaległe zadania w tym tygodniu: ${recap.slippedCount}${recap.slippedTasks.length?'. '+recap.slippedTasks.map(task=>task.title).join('; '):''}.`:'W tym tygodniu nie odnotowano zaległych zadań.';
 return `Twoje podsumowanie tygodnia. Ukończone zadania: ${recap.tasksDone}. ${best} Twoja seria: ${quantity(recap.streak,'day')}. ${slipped} Jedna sugestia: ${tr(recap.suggestion)}`;
}
