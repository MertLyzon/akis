import {useCallback,useLayoutEffect,useRef} from 'react';
import type {NavigationReporter} from './navigationSafety';

export function useNavigationSafety(report:NavigationReporter|undefined,sensitive:boolean){
  const pending=useRef(false),shown=useRef(false),latest=useRef(report);
  latest.current=report;
  const publish=useCallback(()=>latest.current?.({pending:pending.current,sensitive:shown.current}),[]);
  useLayoutEffect(()=>{shown.current=sensitive;publish()},[sensitive,publish]);
  useLayoutEffect(()=>()=>latest.current?.({pending:false,sensitive:false}),[]);
  // Publish before awaiting a request, not after a React render.
  return useCallback((value:boolean)=>{pending.current=value;publish()},[publish]);
}
