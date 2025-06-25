# Code Structure

This document describes the code structure of Hail Batch, including key classes, modules, and their relationships.

## Overview

The Hail Batch codebase is organized into several main packages, each responsible for different aspects of the system. The code follows a layered architecture with clear separation between cloud-specific implementations and common abstractions.

## Package Structure

```mermaid
graph TB
    subgraph "batch/"
        subgraph "batch/"
            DR[driver/]
            CL[cloud/]
            WR[worker/]
            FR[front_end/]
            UT[utils/]
        end
        
        subgraph "batch/driver/"
            DC[driver.py]
            IC[instance_collection/]
            IN[instance.py]
            JO[job.py]
            RM[resource_manager.py]
            LO[location.py]
            CA[canceller.py]
        end
        
        subgraph "batch/cloud/"
            CD[driver.py]
            subgraph "gcp/"
                GD[driver/]
                GR[resource_manager.py]
                GB[billing_manager.py]
            end
            subgraph "azure/"
                AD[driver/]
                AR[resource_manager.py]
                AB[billing_manager.py]
            end
            subgraph "terra/"
                TD[driver/]
            end
        end
        
        subgraph "batch/worker/"
            WW[worker.py]
            WJ[jvm.py]
            WC[container.py]
        end
    end
```

## Core Classes and Relationships

### Driver Layer

```mermaid
classDiagram
    class CloudDriver {
        <<abstract>>
        +inst_coll_manager: InstanceCollectionManager
        +billing_manager: CloudBillingManager
        +shutdown()
        +get_quotas()
    }
    
    class GCPDriver {
        -compute_client: GoogleComputeClient
        -activity_logs_client: GoogleLoggingClient
        -zone_monitor: ZoneMonitor
        -inst_coll_manager: InstanceCollectionManager
        -job_private_inst_manager: JobPrivateInstanceManager
        -billing_manager: GCPBillingManager
    }
    
    class AzureDriver {
        -arm_client: AzureResourceManagerClient
        -compute_client: AzureComputeClient
        -region_monitor: RegionMonitor
        -inst_coll_manager: InstanceCollectionManager
        -job_private_inst_manager: JobPrivateInstanceManager
        -billing_manager: AzureBillingManager
    }
    
    class TerraAzureDriver {
        -terra_client: TerraClient
        -region_monitor: SingleRegionMonitor
        -inst_coll_manager: InstanceCollectionManager
        -job_private_inst_manager: JobPrivateInstanceManager
        -billing_manager: AzureBillingManager
    }
    
    CloudDriver <|-- GCPDriver
    CloudDriver <|-- AzureDriver
    CloudDriver <|-- TerraAzureDriver
```

### Instance Collection Layer

```mermaid
classDiagram
    class InstanceCollectionManager {
        -db: Database
        -machine_name_prefix: str
        -location_monitor: CloudLocationMonitor
        -name_inst_coll: Dict[str, InstanceCollection]
        +register_instance_collection()
        +choose_location()
        +pools: Dict[str, InstanceCollection]
        +name_instance: Dict[str, Instance]
    }
    
    class InstanceCollection {
        <<abstract>>
        -db: Database
        -inst_coll_manager: InstanceCollectionManager
        -resource_manager: CloudResourceManager
        -cloud: str
        -name: str
        -is_pool: bool
        -name_instance: Dict[str, Instance]
        +add_instance()
        +remove_instance()
        +monitor_instances()
    }
    
    class Pool {
        -scheduler: PoolScheduler
        -healthy_instances_by_free_cores: SortedSet
        -worker_type: str
        -worker_cores: int
        -preemptible: bool
        +create_instances()
        +schedule_jobs()
    }
    
    class JobPrivateInstanceManager {
        -async_worker_pool: AsyncWorkerPool
        -exceeded_shares_counter: ExceededSharesCounter
        +create_instances_loop_body()
        +schedule_jobs_loop_body()
    }
    
    class PoolScheduler {
        -pool: Pool
        -async_worker_pool: AsyncWorkerPool
        -exceeded_shares_counter: ExceededSharesCounter
        +schedule_loop_body()
        +compute_fair_share()
    }
    
    InstanceCollectionManager --> InstanceCollection
    InstanceCollection <|-- Pool
    InstanceCollection <|-- JobPrivateInstanceManager
    Pool --> PoolScheduler
```

### Instance and Resource Management

```mermaid
classDiagram
    class Instance {
        -name: str
        -state: str
        -cores: int
        -location: str
        -machine_type: str
        -preemptible: bool
        -free_cores_mcpu: int
        -failed_request_count: int
        +activate()
        +deactivate()
        +adjust_free_cores_in_memory()
    }
    
    class CloudResourceManager {
        <<abstract>>
        +machine_type()
        +instance_config()
        +create_vm()
        +delete_vm()
        +get_vm_state()
    }
    
    class GCPResourceManager {
        -project: str
        -compute_client: GoogleComputeClient
        -billing_manager: GCPBillingManager
    }
    
    class AzureResourceManager {
        -subscription_id: str
        -resource_group: str
        -compute_client: AzureComputeClient
        -billing_manager: AzureBillingManager
    }
    
    class CloudBillingManager {
        <<abstract>>
        +refresh_resources_from_retail_prices()
        +get_resource_rate()
    }
    
    class GCPBillingManager {
        -project: str
        -regions: List[str]
    }
    
    class AzureBillingManager {
        -subscription_id: str
        -regions: List[str]
    }
    
    CloudResourceManager <|-- GCPResourceManager
    CloudResourceManager <|-- AzureResourceManager
    CloudBillingManager <|-- GCPBillingManager
    CloudBillingManager <|-- AzureBillingManager
    Instance --> CloudResourceManager
```

### Worker Layer

```mermaid
classDiagram
    class Worker {
        -active: bool
        -cores_mcpu: int
        -cpu_sem: FIFOWeightedSemaphore
        -jobs: Dict[Tuple[int, int], Job]
        -pool: ThreadPoolExecutor
        -task_manager: BackgroundTaskManager
        -fs: RouterAsyncFS
        -file_store: FileStore
        +run_job()
        +create_job()
        +post_job_started()
        +post_job_complete()
    }
    
    class Job {
        <<abstract>>
        -batch_id: int
        -job_id: int
        -user: str
        -credentials: Dict[str, str]
        -job_spec: dict
        -state: str
        -worker: Worker
        +run()
        +delete()
        +mark_started()
        +mark_complete()
    }
    
    class DockerJob {
        -containers: Dict[str, Container]
        -cloudfuse: List[dict]
        +setup_io()
        +run_container()
    }
    
    class JVMJob {
        -jvm: JVM
        -jar_url: str
        -argv: List[str]
        -profile_file: str
        +write_batch_config()
    }
    
    class JVM {
        -n_cores: int
        -socket_file: str
        -container: JVMContainer
        -cloudfuse_mount_manager: CloudfuseMountManager
        +reset()
        +kill()
    }
    
    class Container {
        -name: str
        -image: Image
        -command: List[str]
        -cpu_in_mcpu: int
        -memory_in_bytes: int
        -volume_mounts: List[MountSpecification]
        +create()
        +start()
        +stop()
        +delete()
    }
    
    Worker --> Job
    Job <|-- DockerJob
    Job <|-- JVMJob
    JVMJob --> JVM
    JVM --> Container
    DockerJob --> Container
```

## Key Modules and Their Responsibilities

### Driver Modules

| Module | Purpose | Key Classes |
|--------|---------|-------------|
| `driver/driver.py` | Abstract cloud driver interface | `CloudDriver` |
| `driver/instance_collection/` | Instance collection management | `InstanceCollectionManager`, `Pool`, `JobPrivateInstanceManager` |
| `driver/instance.py` | Individual instance representation | `Instance` |
| `driver/job.py` | Job scheduling and state management | `schedule_job()`, `mark_job_errored()` |
| `driver/resource_manager.py` | Abstract resource management | `CloudResourceManager` |
| `driver/location.py` | Region/zone monitoring | `CloudLocationMonitor` |
| `driver/canceller.py` | Job cancellation logic | `Canceller` |

### Cloud-Specific Modules

| Cloud | Module | Purpose | Key Classes |
|-------|--------|---------|-------------|
| **GCP** | `cloud/gcp/driver/` | GCP-specific driver | `GCPDriver` |
| **GCP** | `cloud/gcp/resource_manager.py` | GCP VM management | `GCPResourceManager` |
| **GCP** | `cloud/gcp/billing_manager.py` | GCP pricing | `GCPBillingManager` |
| **Azure** | `cloud/azure/driver/` | Azure-specific driver | `AzureDriver` |
| **Azure** | `cloud/azure/resource_manager.py` | Azure VM management | `AzureResourceManager` |
| **Azure** | `cloud/azure/billing_manager.py` | Azure pricing | `AzureBillingManager` |
| **Terra** | `cloud/terra/azure/driver/` | Terra Azure driver | `TerraAzureDriver` |

### Worker Modules

| Module | Purpose | Key Classes |
|--------|---------|-------------|
| `worker/worker.py` | Main worker implementation | `Worker` |
| `worker/jvm.py` | JVM job execution | `JVM`, `JVMPool` |
| `worker/container.py` | Container management | `Container`, `Image` |

## Data Flow

### Job Scheduling Flow

```mermaid
sequenceDiagram
    participant S as Scheduler
    participant ICM as InstanceCollectionManager
    participant P as Pool
    participant I as Instance
    participant W as Worker
    participant DB as Database
    
    S->>ICM: Get available instances
    ICM->>P: Get healthy instances
    P->>I: Check free cores
    I->>S: Return available capacity
    S->>DB: Query ready jobs
    S->>I: Select instance for job
    S->>DB: Schedule job (SJ)
    S->>W: Send job to worker
    W->>DB: Mark job started (MJS)
    W->>DB: Mark job complete (MJC)
```

### Instance Creation Flow

```mermaid
sequenceDiagram
    participant A as Autoscaler
    participant ICM as InstanceCollectionManager
    participant RM as ResourceManager
    participant Cloud as Cloud Provider
    participant DB as Database
    
    A->>ICM: Calculate required instances
    ICM->>RM: Create VM configuration
    RM->>Cloud: Create VM
    Cloud->>RM: VM created
    RM->>DB: Create instance record
    RM->>ICM: Register instance
    ICM->>A: Instance available
```

## Configuration Structure

### Instance Collection Configuration

```python
# Example configuration structure
class PoolConfig:
    name: str                    # Pool name (e.g., "standard")
    cloud: str                   # Cloud provider
    worker_type: str             # Machine type family
    worker_cores: int            # Cores per worker
    preemptible: bool            # Use preemptible instances
    max_instances: int           # Maximum total instances
    max_live_instances: int      # Maximum running instances
    worker_max_idle_time_secs: int  # Idle timeout
    autoscaler_loop_period_secs: int  # Autoscaler frequency
```

### Job Specification

```python
# Example job specification structure
job_spec = {
    "job_id": int,
    "batch_id": int,
    "user": str,
    "process": {
        "type": "docker" | "jvm",
        "image": str,           # For docker jobs
        "command": List[str],   # For docker jobs
        "jar_spec": dict,       # For jvm jobs
    },
    "resources": {
        "cores_mcpu": int,
        "memory_bytes": int,
        "storage_gib": int,
    },
    "regions": List[str],       # Allowed regions
    "cloudfuse": List[dict],    # Cloud storage mounts
    "secrets": List[dict],      # Kubernetes secrets
}
```

## Database Schema Overview

### Key Tables

```mermaid
erDiagram
    BATCHES {
        int id PK
        string state
        int billing_project_id FK
        string user
        timestamp time_created
    }
    
    JOBS {
        int batch_id PK,FK
        int job_id PK
        string state
        int cores_mcpu
        string inst_coll
        string attempt_id
        timestamp time_ready
    }
    
    INSTANCES {
        string name PK
        string inst_coll FK
        string state
        int cores
        string location
        string machine_type
        boolean preemptible
    }
    
    ATTEMPTS {
        int batch_id PK,FK
        int job_id PK,FK
        string attempt_id PK
        string instance_name FK
        timestamp start_time
        timestamp end_time
    }
    
    BATCHES ||--o{ JOBS : contains
    JOBS ||--o{ ATTEMPTS : has
    INSTANCES ||--o{ ATTEMPTS : runs
```

## Error Handling Patterns

### Exception Hierarchy

```mermaid
classDiagram
    class BatchException {
        <<abstract>>
        +message: str
    }
    
    class JobException {
        +batch_id: int
        +job_id: int
    }
    
    class InstanceException {
        +instance_name: str
    }
    
    class ResourceException {
        +resource_type: str
    }
    
    class UserError {
        +user_message: str
    }
    
    class SystemError {
        +system_message: str
    }
    
    BatchException <|-- JobException
    BatchException <|-- InstanceException
    BatchException <|-- ResourceException
    BatchException <|-- UserError
    BatchException <|-- SystemError
```

## Testing Structure

### Test Organization

```mermaid
graph TB
    subgraph "test/"
        UT[unit/]
        IT[integration/]
        ET[end-to-end/]
    end
    
    subgraph "unit/"
        TD[test_driver.py]
        TI[test_instance.py]
        TJ[test_job.py]
        TW[test_worker.py]
    end
    
    subgraph "integration/"
        TIC[test_instance_collection.py]
        TSC[test_scheduler.py]
        TAC[test_autoscaler.py]
    end
    
    subgraph "end-to-end/"
        TBE[test_batch_execution.py]
        TWE[test_worker_execution.py]
    end
```

## Performance Considerations

### Critical Paths

1. **Scheduling Loop**: Must complete within 1 second
2. **Job State Updates**: Database operations must be fast
3. **Instance Monitoring**: Health checks every 60 seconds
4. **Autoscaler**: Runs every 15 seconds

### Bottlenecks

- **Database locks**: Concurrent job scheduling
- **Cloud API limits**: VM creation rate limits
- **Network latency**: Worker-to-driver communication
- **Resource contention**: CPU/memory allocation

## Extension Points

### Adding New Cloud Providers

1. Implement `CloudDriver` interface
2. Create cloud-specific `ResourceManager`
3. Create cloud-specific `BillingManager`
4. Add configuration support
5. Update factory functions

### Adding New Job Types

1. Extend `Job` base class
2. Implement job-specific execution logic
3. Add worker support for new job type
4. Update job specification schema
5. Add tests for new job type 