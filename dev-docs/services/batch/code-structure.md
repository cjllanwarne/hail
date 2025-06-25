# Code Structure

This document describes the code structure of Hail Batch, organized around its three major components: the batch/DAG interpreter, worker VM manager, and job scheduler.

## Overview

Hail Batch is built around three core components that work together to execute batch workloads:

1. **Batch/DAG Interpreter** - Parses and manages job dependencies and batch lifecycle
2. **Worker VM Manager** - Provisions, manages, and monitors worker VMs across cloud providers
3. **Job Scheduler** - Matches jobs to available workers and manages execution

## Architecture Overview

```mermaid
graph TB
    subgraph "Batch/DAG Interpreter"
        FE[Frontend Service]
        DB[(Database)]
        BQ[Batch Queue]
    end
    
    subgraph "Job Scheduler"
        SC[Scheduler]
        AS[Autoscaler]
        FS[Fair Share]
    end
    
    subgraph "Worker VM Manager"
        ICM[Instance Collection Manager]
        RM[Resource Manager]
        BM[Billing Manager]
    end
    
    subgraph "Worker VMs"
        W1[Worker 1]
        W2[Worker 2]
        WN[Worker N]
    end
    
    FE --> DB
    FE --> BQ
    BQ --> SC
    SC --> ICM
    AS --> ICM
    ICM --> W1
    ICM --> W2
    ICM --> WN
    RM --> ICM
    BM --> ICM
    SC --> W1
    SC --> W2
    SC --> WN
```

## Component 1: Batch/DAG Interpreter

### Purpose
The batch/DAG interpreter is responsible for:
- Parsing user-submitted batch specifications
- Managing job dependencies and DAG execution
- Tracking batch and job state transitions
- Providing user interfaces (REST API and Web UI)

### Key Classes and Modules

```mermaid
classDiagram
    class BatchFrontend {
        -db: Database
        -file_store: FileStore
        +create_batch()
        +create_jobs()
        +commit_update()
        +get_batch_status()
    }
    
    class Batch {
        -id: int
        -state: str
        -user: str
        -billing_project_id: int
        -time_created: timestamp
        +jobs: List[Job]
        +updates: List[Update]
    }
    
    class Job {
        -batch_id: int
        -job_id: int
        -state: str
        -dependencies: List[Job]
        -children: List[Job]
        -spec: JobSpec
        +attempts: List[Attempt]
    }
    
    class JobSpec {
        -process: ProcessSpec
        -resources: ResourceSpec
        -regions: List[str]
        -cloudfuse: List[dict]
        -secrets: List[dict]
    }
    
    class Update {
        -batch_id: int
        -update_id: int
        -state: str
        -jobs: List[Job]
        +commit()
    }
    
    BatchFrontend --> Batch
    Batch --> Job
    Job --> JobSpec
    Batch --> Update
    Update --> Job
```

### Code Location
- **Main module**: `batch/front_end/`
- **Key files**:
  - `front_end.py` - Main frontend service
  - `query/` - Database query logic
  - `templates/` - Web UI templates

### Data Flow

```mermaid
sequenceDiagram
    participant U as User
    participant FE as Frontend
    participant DB as Database
    participant CS as Cloud Storage
    
    U->>FE: Submit batch
    FE->>DB: Create batch record
    FE->>FE: Parse job dependencies
    FE->>DB: Create job records
    FE->>CS: Store job specifications
    FE->>DB: Update job states (Pending/Ready)
    FE->>U: Return batch ID
```

## Component 2: Worker VM Manager

### Purpose
The worker VM manager is responsible for:
- Provisioning and managing worker VMs across cloud providers
- Monitoring VM health and performance
- Managing VM lifecycle (create, scale, terminate)
- Abstracting cloud-specific details

### Key Classes and Modules

```mermaid
classDiagram
    class CloudDriver {
        <<abstract>>
        +inst_coll_manager: InstanceCollectionManager
        +billing_manager: CloudBillingManager
        +shutdown()
        +get_quotas()
    }
    
    class InstanceCollectionManager {
        -db: Database
        -location_monitor: CloudLocationMonitor
        -name_inst_coll: Dict[str, InstanceCollection]
        +register_instance_collection()
        +choose_location()
        +pools: Dict[str, InstanceCollection]
    }
    
    class InstanceCollection {
        <<abstract>>
        -name: str
        -is_pool: bool
        -name_instance: Dict[str, Instance]
        +add_instance()
        +remove_instance()
        +monitor_instances()
    }
    
    class Pool {
        -scheduler: PoolScheduler
        -worker_type: str
        -worker_cores: int
        -preemptible: bool
        +create_instances()
        +autoscaler_loop()
    }
    
    class JobPrivateInstanceManager {
        +create_instances_loop_body()
        +schedule_jobs_loop_body()
    }
    
    class Instance {
        -name: str
        -state: str
        -cores: int
        -location: str
        -free_cores_mcpu: int
        +activate()
        +deactivate()
    }
    
    class CloudResourceManager {
        <<abstract>>
        +create_vm()
        +delete_vm()
        +get_vm_state()
        +instance_config()
    }
    
    CloudDriver --> InstanceCollectionManager
    InstanceCollectionManager --> InstanceCollection
    InstanceCollection <|-- Pool
    InstanceCollection <|-- JobPrivateInstanceManager
    InstanceCollection --> Instance
    CloudDriver --> CloudResourceManager
```

### Code Location
- **Main module**: `batch/driver/`
- **Key files**:
  - `driver/driver.py` - Abstract cloud driver interface
  - `driver/instance_collection/` - Instance collection management
  - `driver/instance.py` - Individual instance representation
  - `driver/resource_manager.py` - Abstract resource management
  - `cloud/` - Cloud-specific implementations

### Cloud Provider Support

```mermaid
graph LR
    subgraph "Cloud Drivers"
        GCP[GCP Driver]
        AZ[Azure Driver]
        TR[Terra Driver]
    end
    
    subgraph "Resource Managers"
        GRM[GCP Resource Manager]
        ARM[Azure Resource Manager]
        TRM[Terra Resource Manager]
    end
    
    subgraph "Billing Managers"
        GBM[GCP Billing Manager]
        ABM[Azure Billing Manager]
        TBM[Terra Billing Manager]
    end
    
    GCP --> GRM
    GCP --> GBM
    AZ --> ARM
    AZ --> ABM
    TR --> TRM
    TR --> TBM
```

## Component 3: Job Scheduler

### Purpose
The job scheduler is responsible for:
- Matching ready jobs to available worker VMs
- Implementing fair share resource allocation
- Managing job state transitions
- Coordinating with the autoscaler

### Key Classes and Modules

```mermaid
classDiagram
    class PoolScheduler {
        -pool: Pool
        -async_worker_pool: AsyncWorkerPool
        -exceeded_shares_counter: ExceededSharesCounter
        +schedule_loop_body()
        +compute_fair_share()
        +user_runnable_jobs()
    }
    
    class Autoscaler {
        -pool: Pool
        -max_new_instances_per_loop: int
        -autoscaler_loop_period_secs: int
        +create_instances_loop_body()
        +estimate_required_cores()
    }
    
    class FairShare {
        +compute_fair_share()
        +allocate_cores()
        +user_share_calculation()
    }
    
    class JobMatcher {
        +match_job_to_instance()
        +check_resource_compatibility()
        +select_optimal_instance()
    }
    
    class Canceller {
        +cancel_ready_jobs()
        +cancel_running_jobs()
        +cancel_creating_jobs()
    }
    
    PoolScheduler --> FairShare
    PoolScheduler --> JobMatcher
    Autoscaler --> FairShare
    PoolScheduler --> Canceller
```

### Code Location
- **Main module**: `batch/driver/instance_collection/`
- **Key files**:
  - `pool.py` - Pool scheduler implementation
  - `job_private.py` - Job private instance manager
  - `base.py` - Base instance collection logic

### Scheduling Flow

```mermaid
sequenceDiagram
    participant S as Scheduler
    participant FS as Fair Share
    participant JM as Job Matcher
    participant ICM as Instance Collection Manager
    participant W as Worker
    participant BD as Batch Driver
    participant DB as Database
    
    loop Every second
        S->>FS: Calculate fair share allocation
        FS->>S: Return user allocations
        S->>DB: Query ready jobs by user
        S->>JM: Match jobs to instances
        JM->>ICM: Get available instances
        ICM->>JM: Return instance list
        JM->>S: Return job-instance matches
        S->>DB: Schedule jobs (SJ)
        S->>W: Send job via HTTP POST
        W->>W: Execute job
        W->>BD: POST /api/v1alpha/instances/job_started
        BD->>DB: Mark job started (MJS)
        W->>BD: POST /api/v1alpha/instances/job_complete
        BD->>DB: Mark job complete (MJC)
    end
```

## How the Components Work Together

### High-Level Interaction

```mermaid
graph TB
    subgraph "User Request Flow"
        U[User] --> FE[Frontend]
        FE --> BQ[Batch Queue]
    end
    
    subgraph "Scheduling Flow"
        BQ --> SC[Scheduler]
        SC --> AS[Autoscaler]
        AS --> ICM[Instance Collection Manager]
    end
    
    subgraph "Execution Flow"
        ICM --> W[Worker VMs]
        W --> DB[(Database)]
        DB --> FE
    end
    
    subgraph "State Management"
        DB --> SC
        SC --> DB
        W --> DB
    end
```

### Data Flow Between Components

```mermaid
sequenceDiagram
    participant U as User

    box "Batch Service"
        participant FE as Frontend
    end

    box "Batch Driver"
        participant BDAPI as Batch Driver API
        participant SC as Scheduler
        participant AS as Autoscaler
        participant ICM as Instance Manager    
    end

    participant W as Worker
    participant DB as Database

    U->>FE: Submit batch
    FE->>DB: Store batch & jobs
    FE->>BDAPI: Notify new work available
    
    loop Scheduling Loop
        SC->>DB: Query ready jobs
        SC->>AS: Check if scaling needed
        AS->>ICM: Create instances if needed
        SC->>ICM: Get available instances
        SC->>W: Schedule jobs
        W->>BDAPI: Report job status via HTTP
        BDAPI->>DB: Update job states
    end
    
    W->>BDAPI: Report job completion
    U->>FE: Request batch status
    FE->>DB: Query batch status
    DB->>FE: Return batch status
    FE->>U: Return batch status
```

## Key Interfaces Between Components

### 1. Frontend ↔ Scheduler
- **Batch creation notifications** - Frontend notifies scheduler of new work
- **Job state queries** - Scheduler queries for ready jobs
- **Batch status updates** - Scheduler updates batch completion status

### 2. Scheduler ↔ Instance Manager
- **Instance availability** - Scheduler requests available instances
- **Instance creation** - Scheduler triggers autoscaler for new instances
- **Resource allocation** - Scheduler updates instance resource usage

### 3. Instance Manager ↔ Workers
- **Job assignment** - Instance manager sends jobs to workers
- **Health monitoring** - Workers report status to instance manager
- **Resource tracking** - Workers report resource usage

## Configuration and Extension Points

### Adding New Cloud Providers
1. Implement `CloudDriver` interface
2. Create cloud-specific `ResourceManager`
3. Create cloud-specific `BillingManager`
4. Update factory functions in `cloud/driver.py`

### Adding New Job Types
1. Extend `Job` base class in worker
2. Implement job-specific execution logic
3. Update job specification schema
4. Add scheduler support for new job type

### Modifying Scheduling Logic
1. Extend `PoolScheduler` or create new scheduler
2. Implement custom fair share algorithm
3. Update job matching logic
4. Add new autoscaling policies

## Performance Considerations

### Critical Paths
- **Scheduling loop**: Must complete within 1 second
- **Job state updates**: Database operations must be fast
- **Instance monitoring**: Health checks every 60 seconds
- **Autoscaler**: Runs every 15 seconds

### Bottlenecks
- **Database locks**: Concurrent job scheduling
- **Cloud API limits**: VM creation rate limits
- **Network latency**: Worker-to-driver communication
- **Resource contention**: CPU/memory allocation

## Testing Strategy

### Component Testing
- **Frontend**: API endpoint testing, batch creation flows
- **Scheduler**: Fair share algorithm, job matching logic
- **Instance Manager**: VM lifecycle, health monitoring

### Integration Testing
- **End-to-end**: Complete batch execution flows
- **Cross-component**: Scheduler-instance manager interaction
- **Cloud-specific**: Provider-specific functionality

### Performance Testing
- **Scheduling rate**: Jobs per second throughput
- **Scalability**: Large batch handling
- **Resource efficiency**: VM utilization optimization 