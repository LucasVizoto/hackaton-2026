export interface IndividualAllocation {
  worker:string; registration?:string; name?:string; fraction:string; policy_version:string;
  exact:Record<string,unknown>;
  display:{production:string;supplement:string;collective_floor:string;total_payable:string;rounding_adjustment:string};
}
export interface RuleOccurrence {id:string;worker:string|null;code:string;description:string;resolved_at:string|null;resolution?:string;}
export interface LaborActivity {id:string;worker:string;reference_date:string;warehouse:string;warehouse_name?:string;appointment:string|null;equipment?:string|null;activity_type:string;attendance_state:string;used:boolean;started_at:string|null;finished_at:string|null;notes:string;origin:string;revision:number;}
