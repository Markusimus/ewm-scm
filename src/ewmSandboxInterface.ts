export interface EwmSandboxI {
    /**
     * The local file system path where the sandbox is located.
     */
    sandbox: string;
  
    /**
     * An array of share configurations, each mapping a local directory to a remote EWM component.
     */
    shares: EwmShareI[];
  
    /**
     * An array for status data about the sandbox
     */
    status: any[];
  }
  
 export interface EwmShareI {
    /**
     * The local file system path for this share.
     */
    local: string;
  
    /**
     * Information about the remote EWM component.
     */
    remote: EwmRemote;
  }
  
  interface EwmRemote {
    /**
     * Information about the EWM component being used
     */
    component: EwmComponent;
  
    /**
     * Information about the EWM path within the component.
     */
    path: EwmPath;
  
    /**
     * Information about the EWM workspace.
     */
    workspace: EwmWorkspace;
  }
  
  
  interface EwmComponent {
    /**
     * The name of the EWM component.
     */
    name: string;
  
    /**
     * A unique identifier (UUID) for this EWM component within the system.
     */
    uuid: string;
  }
  
  interface EwmPath {
    /**
     * The path within the EWM component.
     */
    path: string;
  
    /**
      * Indicates the type of target, such as folder.
      */
    type: string;
  
     /**
      * A unique identifier for this specific path within the component.
      */
    uuid: string;
  }
  
  interface EwmWorkspace {
    /**
     * The name of the EWM workspace.
     */
    name: string;
  
    /**
     * A unique identifier for this workspace in the EWM system.
     */
    uuid: string;
  }
