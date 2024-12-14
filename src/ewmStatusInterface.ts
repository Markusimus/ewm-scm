
interface ChangeState {
    add: boolean;
    conflict: boolean;
    content_change: boolean;
    delete: boolean;
    move: boolean;
    potential_conflict: boolean;
    property_change: boolean;
}

export interface ChangeI {
    "inaccessible-change": boolean;
    merges: any[];
    path: string;
    state: ChangeState;
    "state-id": string;
    uuid: string;
}


export interface ChangesetI {
    author: string;
    changes: ChangeI[];
    comment: string;
    modified: string;
    state: {
        active: boolean;
        complete: boolean;
        conflict: boolean;
        current: boolean;
        current_merge_target: boolean;
        has_source: boolean;
        is_linked: boolean;
        is_source: boolean;
        potential_conflict: boolean;
    };
    url: string;
    uuid: string;
}

interface Baseline {
    id: number;
    name: string;
    url?: string;
    uuid: string;
}


interface FlowTarget {
    "incoming-flow": {
        name: string;
        type?: string;
        url: string;
        uuid: string;
        userId?: string
    };
    name: string;
     "outgoing-flow": {
        name: string;
        type?: string;
        url: string;
        uuid: string;
         userId?:string
    };
    type?: string;
    url: string;
    uuid: string;
    userId?: string;
}


export interface UnresolvedChangeI {
    path: string;
    state: {
        add: boolean;
        content_change: boolean;
        delete: boolean;
        move: boolean;
        property_change: boolean;
    };
    uuid: string;
}

export interface ComponentI {
    baseline: Baseline;
    "changesets-after-baseline": boolean;
    "changesets-after-incoming-target-baseline": boolean;
    "flow-target": FlowTarget;
    "hierarchy-is-diverged": boolean;
    "incoming-addition": boolean;
    "incoming-changes": ChangesetI[];
    "incoming-deletion": boolean;
    "incoming-hierarchy-is-diverged": boolean;
    "incoming-replacement": boolean;
    "incoming-target-baseline": Baseline;
    is_comp_loaded: boolean;
    name: string;
    "outgoing-addition": boolean;
    "outgoing-changes": ChangesetI[];
    "outgoing-deletion": boolean;
    "outgoing-replacement": boolean;
    suspended: any[];
    type: string | null;
    uuid: string;
    operation?: string;
    unresolved?: UnresolvedChangeI[];
}


interface Workspace {
    components: ComponentI[];
    "flow-target": FlowTarget;
    isTracked: string;
    name: string;
    type: string;
    url: string;
    userId: string;
    uuid: string;
}


export interface StatusDataI {
    workspaces: Workspace[];
}

export default StatusDataI;
// export ComponentI;
