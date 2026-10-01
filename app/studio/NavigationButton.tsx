import type {ComponentProps} from 'react';
import {SidebarMenuButton,useSidebar} from '@/components/ui/sidebar';

/** A destination selection should dismiss the drawer on a small screen. */
export default function NavigationButton({onClick,...props}:ComponentProps<typeof SidebarMenuButton>){
  const {isMobile,setOpenMobile}=useSidebar();
  return <SidebarMenuButton {...props} onClick={event=>{
    onClick?.(event);
    if(isMobile&&!event.defaultPrevented)setOpenMobile(false);
  }}/>;
}
