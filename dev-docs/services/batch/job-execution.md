# Job Execution

This document describes how Hail Batch executes jobs, including the scheduling process, job-to-VM matching, execution flow, and state management.

## Overview

Job execution in Hail Batch involves multiple components working together to schedule, match, and execute jobs on worker VMs. The system supports both Docker jobs (user-defined containers) and JVM jobs (for Hail Query on Batch).

## Job Execution Architecture

```mermaid
graph TB
    subgraph "Batch Frontend"
        UI[User Interface]
        API[REST API]
    end
    
    subgraph "Batch Driver"
        S[Scheduler]
        A[Autoscaler]
        C[Canceller]
    end
    
    subgraph "Instance Collections"
        P[Pools]
        JPIM[Job Private Instance Manager]
    end
    
    subgraph "Worker VMs"
        W1[Worker 1]
        W2[Worker 2]
        WN[Worker N]
    end
    
    subgraph "Storage"
        CS[Cloud Storage]
        DB[Database]
    end
    
    UI --> API
    API --> S
    S --> P
    S --> JPIM
    P --> W1
    P --> W2
    JPIM --> WN
    
    A --> P
    A --> JPIM
    
    W1 --> CS
    W2 --> CS
    WN --> CS
    
    S --> DB
    W1 --> DB
    W2 --> DB
    WN --> DB
```

## Job Lifecycle

### Job States

```mermaid
stateDiagram-v2
    [*] --> Pending: Job created with dependencies
    Pending --> Ready: All dependencies complete
    Ready --> Creating: Job private instance creation
    Ready --> Running: Job scheduled on worker
    Creating --> Running: Instance ready, job scheduled
    Running --> Success: Job completed successfully
    Running --> Failed: Job failed
    Running --> Error: System error
    Running --> Cancelled: Job cancelled
    Ready --> Cancelled: Job cancelled before running
    Creating --> Cancelled: Job cancelled during creation
    
    note right of Pending
        Waiting for parent jobs
        to complete
    end note
    
    note right of Ready
        Ready to be scheduled
        on available worker
    end note
    
    note right of Running
        Executing on worker VM
        in container
    end note
```

## Scheduling Process

### Scheduler Overview

```mermaid
sequenceDiagram
    participant S as Scheduler
    participant DB as Database
    participant ICM as Instance Collection Manager
    participant W as Worker VM
    participant CS as Cloud Storage
    
    loop Every second
        S->>DB: Query ready jobs by fair share
        S->>ICM: Get available instances
        S->>S: Match jobs to instances
        S->>DB: Update job state (SJ)
        S->>W: Send job to worker
        W->>CS: Download job spec
        W->>W: Execute job
        W->>DB: Mark job started (MJS)
        W->>DB: Mark job complete (MJC)
    end
```

### Fair Share Scheduling

```mermaid
graph TD
    A[Calculate Fair Share] --> B[Sort users by running cores]
    B --> C[Allocate cores to users with fewest]
    C --> D[Distribute remaining cores equally]
    D --> E[Select jobs for each user]
    E --> F[Match jobs to available instances]
    F --> G[Schedule jobs on workers]
    
    subgraph "Fair Share Example"
        U1[User A: 0 cores running]
        U2[User B: 10 cores running]
        U3[User C: 20 cores running]
        
        U1 -->|Gets priority| A1[Allocate to User A first]
        A1 --> A2[Then equal distribution]
    end
```

## Job-to-VM Matching

### Matching Algorithm

```mermaid
graph TB
    subgraph "Job Requirements"
        JR[Job Resource Request<br/>CPU, Memory, Storage, Regions]
    end
    
    subgraph "Instance Selection"
        IS[Instance Selection Logic]
        P[Pool Selection]
        JP[Job Private Selection]
    end
    
    subgraph "Available Instances"
        AI1[Pool Instance 1<br/>4 cores free]
        AI2[Pool Instance 2<br/>8 cores free]
        AI3[Job Private Instance<br/>16 cores free]
    end
    
    JR --> IS
    IS --> P
    IS --> JP
    
    P --> AI1
    P --> AI2
    JP --> AI3
    
    AI1 -->|Match if job ≤ 4 cores| M1[Match to Instance 1]
    AI2 -->|Match if job ≤ 8 cores| M2[Match to Instance 2]
    AI3 -->|Match if job ≤ 16 cores| M3[Match to Instance 3]
```

### Resource Matching Logic

The job-to-VM matching process follows these steps:

1. **Resource Requirements Check**
   - CPU cores (in mCPU units)
   - Memory (in bytes)
   - Storage (in GiB)
   - Region constraints

2. **Instance Type Selection**
   - **Pool instances**: For standard resource requirements
   - **Job private instances**: For specific machine types or large resource needs

3. **Instance Selection**
   - Find instances with sufficient free resources
   - Prefer instances in requested regions
   - Consider instance health and performance

## Job Execution Flow

### Docker Job Execution

```mermaid
sequenceDiagram
    participant BD as Batch Driver
    participant W as Worker VM
    participant CS as Cloud Storage
    participant C as Container
    
    BD->>W: Schedule job with spec
    W->>CS: Download job specification
    W->>W: Create job scratch directory
    W->>W: Setup input/output mounts
    W->>W: Pull Docker image
    W->>C: Create and start container
    C->>C: Execute user code
    C->>W: Write output files
    W->>CS: Upload output files
    W->>BD: Report job completion
```

### JVM Job Execution

```mermaid
sequenceDiagram
    participant BD as Batch Driver
    participant W as Worker VM
    participant JVM as JVM Container
    participant CS as Cloud Storage
    
    BD->>W: Schedule JVM job
    W->>W: Borrow JVM from pool
    W->>CS: Download JAR file
    W->>JVM: Execute JVM job
    JVM->>JVM: Run Hail query
    JVM->>W: Return results
    W->>CS: Upload results
    W->>W: Return JVM to pool
    W->>BD: Report job completion
```

## Container Management

### Container Types

```mermaid
graph LR
    subgraph "Docker Jobs"
        DJ[Docker Container<br/>User-defined image]
        DJ --> |Runs| UC[User Code]
    end
    
    subgraph "JVM Jobs"
        JVM[JVM Container<br/>Hail-approved JARs]
        JVM --> |Runs| HQ[Hail Query]
    end
    
    subgraph "Support Containers"
        IC[Input Container<br/>File preparation]
        OC[Output Container<br/>File upload]
    end
```

### Container Lifecycle

```mermaid
stateDiagram-v2
    [*] --> Created: Container created
    Created --> Running: Container started
    Running --> Completed: Job finished
    Running --> Failed: Job failed
    Running --> Cancelled: Job cancelled
    Completed --> Cleaned: Resources cleaned
    Failed --> Cleaned: Resources cleaned
    Cancelled --> Cleaned: Resources cleaned
    Cleaned --> [*]
```

## Network Isolation

### Network Namespaces

```mermaid
graph TB
    subgraph "Worker VM"
        HN[Host Network<br/>172.18.0.0/16]
    end
    
    subgraph "Job Networks"
        PN[Private Network<br/>172.20.0.0/16]
        PBN[Public Network<br/>172.21.0.0/16]
    end
    
    subgraph "Job Containers"
        JC1[Job Container 1<br/>172.20.1.11]
        JC2[Job Container 2<br/>172.21.1.11]
    end
    
    HN --> PN
    HN --> PBN
    PN --> JC1
    PBN --> JC2
```

### Network Configuration

- **Private jobs**: Access to internal services, metadata server
- **Public jobs**: Internet access, restricted internal access
- **Network isolation**: Each job gets its own network namespace
- **IP masquerading**: Outbound traffic appears to come from host

## Resource Management

### Storage Management

```mermaid
graph TB
    subgraph "Storage Types"
        SD[Scratch Directory<br/>Job temporary files]
        ID[Input Directory<br/>Job input files]
        OD[Output Directory<br/>Job output files]
        CD[CloudFuse<br/>Cloud storage mounts]
    end
    
    subgraph "Storage Quotas"
        XFS[XFS Quotas<br/>Per-job limits]
    end
    
    SD --> XFS
    ID --> XFS
    OD --> XFS
    CD --> XFS
```

### CPU and Memory Management

- **CPU semaphores**: Ensure jobs don't exceed allocated cores
- **Memory limits**: Container memory limits based on job specification
- **Resource monitoring**: Real-time tracking of resource usage
- **OOM handling**: Automatic job termination on memory exhaustion

## Job State Updates

### State Update Operations

```mermaid
sequenceDiagram
    participant W as Worker
    participant BD as Batch Driver
    participant DB as Database
    
    Note over W,DB: SJ - Schedule Job
    BD->>DB: Create attempt record
    BD->>DB: Update job state to Running
    BD->>DB: Subtract cores from instance
    
    Note over W,DB: MJS - Mark Job Started
    W->>BD: Job started notification
    BD->>DB: Update attempt start time
    BD->>DB: Record resource usage
    
    Note over W,DB: MJC - Mark Job Complete
    W->>BD: Job completion notification
    BD->>DB: Update attempt end time
    BD->>DB: Update job state
    BD->>DB: Trigger dependent jobs
```

### Database Operations

The three main job state update operations:

1. **SJ (Schedule Job)**
   - Creates attempt record
   - Updates job state to "Running"
   - Subtracts allocated cores from instance

2. **MJS (Mark Job Started)**
   - Updates attempt start time
   - Records initial resource usage
   - Triggers billing calculations

3. **MJC (Mark Job Complete)**
   - Updates attempt end time
   - Sets final job state
   - Triggers dependent job scheduling
   - Updates batch completion status

## Error Handling

### Failure Scenarios

```mermaid
graph TD
    A[Job Failure] --> B{Error Type?}
    B -->|User Error| C[Job Failed<br/>User code error]
    B -->|System Error| D[Job Error<br/>System issue]
    B -->|Resource Error| E[OOM/Timeout<br/>Resource limits]
    B -->|Network Error| F[Network Issue<br/>Connectivity]
    
    C --> G[Retry Logic]
    D --> G
    E --> G
    F --> G
    
    G --> H{Max Retries?}
    H -->|No| I[Retry Job]
    H -->|Yes| J[Mark Job Failed]
    
    I --> K[New Attempt]
    K --> A
```

### Retry Logic

- **User errors**: No retries (user code issues)
- **System errors**: Automatic retries with exponential backoff
- **Resource errors**: Retry on different instance if possible
- **Network errors**: Retry with network reconfiguration

## Performance Considerations

### Scheduling Performance

- **Target**: 80+ jobs per second scheduling rate
- **Optimizations**: Database indexing, connection pooling
- **Bottlenecks**: Database locks, network latency

### Execution Performance

- **Container startup**: Optimized image layers, caching
- **File I/O**: Local SSD storage, parallel uploads
- **Network**: Optimized routing, connection reuse

## Monitoring and Observability

### Metrics

- **Scheduling rate**: Jobs scheduled per second
- **Execution time**: Job runtime distribution
- **Resource utilization**: CPU, memory, storage usage
- **Error rates**: Failure rates by error type

### Logging

- **Worker logs**: Container execution logs
- **Driver logs**: Scheduling and management logs
- **Application logs**: User application output
- **System logs**: Infrastructure and network logs 