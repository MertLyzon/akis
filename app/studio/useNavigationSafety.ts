import {createContext,useCallback,useContext,useId,useLayoutEffect,useRef} from 'react';
import type {NavigationReporter,NavigationStatus} from './navigationSafety';

export const NavigationContext=createContext<((source:string,status:NavigationStatus)=>void)|undefined>(undefined);

export function useNavigationSafety(report:NavigationReporter|undefined,sensitive:boolean,dirty=false){
  const context=useContext(NavigationContext),id=useId();
  const reportContext=useCallback((status:NavigationStatus)=>context?.(id,status),[context,id]);
  const pending=useRef(false),shown=useRef(false),edited=useRef(false),latest=useRef(report);
  latest.current=report||reportContext;
  const publish=useCallback(()=>latest.current?.({pending:pending.current,sensitive:shown.current,dirty:edited.current}),[]);
  useLayoutEffect(()=>{shown.current=sensitive;edited.current=dirty;publish()},[sensitive,dirty,publish]);
  useLayoutEffect(()=>()=>latest.current?.({pending:false,sensitive:false}),[]);
  // Publish before awaiting a request, not after a React render.
  return useCallback((value:boolean)=>{pending.current=value;publish()},[publish]);
}
