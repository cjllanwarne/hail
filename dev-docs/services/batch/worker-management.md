# Worker Management

This document describes how Hail Batch manages worker VMs, including their hierarchy, initialization, lifecycle, and resource management.

## Overview

Worker management in Hail Batch follows a hierarchical structure that abstracts cloud-specific details while providing unified management across different cloud providers (GCP, Azure, Terra).

## Architecture Hierarchy

```mermaid
graph TB
    subgraph "Cloud Level"
        CD[Cloud Driver<br/>GCP/Azure/Terra]
    end
    
    subgraph "Management Level"
        ICM[Instance Collection Manager]
    end
    
    subgraph "Collection Level"
        subgraph "Pools (Multi-tenant)"
            SP[Standard Pool]
            HP[High CPU Pool]
            HMP[High Memory Pool]
        end
        
        JPIM[Job Private Instance Manager]
    end
    
    subgraph "Instance Level"
        I1[Instance 1<br/>Worker VM]
        I2[Instance 2<br/>Worker VM]
        I3[Instance N<br/>Worker VM]
    end
    
    subgraph "Resource Management"
        RM[Resource Manager]
        BM[Billing Manager]
        LM[Location Monitor]
    end
    
    CD --> ICM
    ICM --> SP
    ICM --> HP
    ICM --> HMP
    ICM --> JPIM
    
    SP --> I1
    HP --> I2
    JPIM --> I3
    
    ICM --> RM
    ICM --> BM
    ICM --> LM
```

## Worker VM Initialization

### Startup Process

```mermaid
sequenceDiagram
    participant BD as Batch Driver
    participant ICM as Instance Collection Manager
    participant RM as Resource Manager
    participant Cloud as Cloud Provider
    participant Worker as Worker VM
    participant DB as Database
    
    BD->>ICM: Create instance request
    ICM->>RM: Generate instance config
    RM->>Cloud: Create VM with startup script
    Cloud->>Worker: Boot VM with cloud-init
    Worker->>Worker: Execute startup script
    Note over Worker: Install Docker, setup networking
    Worker->>Worker: Pull worker image
    Worker->>Worker: Start worker container
    Worker->>BD: Activate with token
    BD->>DB: Update instance state
    BD->>ICM: Register active instance
```

### Startup Script Components

The startup script performs several key operations:

1. **System Setup**
   - Install Docker and dependencies
   - Configure networking (iptables rules)
   - Setup data disks and mount points

2. **Worker Container Launch**
   - Pull the batch worker image
   - Create and start the worker container
   - Pass environment variables and configuration

3. **Activation**
   - Contact the batch driver with activation token
   - Register as available for job scheduling

## Instance Collections

### Pool Types

Hail Batch maintains three main pool types, each optimized for different workloads:

| Pool Type | Memory/Core | Use Case | Machine Types |
|-----------|-------------|----------|---------------|
| **highcpu** | ~1GB/core | CPU-intensive workloads | n1-highcpu-* |
| **standard** | ~4GB/core | General purpose | n1-standard-* |
| **highmem** | ~8GB/core | Memory-intensive workloads | n1-highmem-* |

### Pool vs Job Private

```mermaid
graph LR
    subgraph "Pool (Multi-tenant)"
        P1[Pool Instance 1<br/>Job A, Job B, Job C]
        P2[Pool Instance 2<br/>Job D, Job E]
    end
    
    subgraph "Job Private"
        JP1[Instance 1<br/>Job X only]
        JP2[Instance 2<br/>Job Y only]
    end
    
    P1 -.->|Shared resources| P2
    JP1 -.->|Isolated| JP2
```

**Pool Instances:**
- Multiple jobs can run on the same VM
- Resource sharing and isolation via containers
- Cost-effective for small to medium jobs
- Automatic scaling based on demand

**Job Private Instances:**
- One VM per job
- Full resource isolation
- Used for specific machine type requirements
- Common for jobs requiring >16 cores or special configurations

## Resource Management

### Location Selection

```mermaid
graph TD
    A[Job Request] --> B{Region Constraints?}
    B -->|Yes| C[Filter by allowed regions]
    B -->|No| D[Use all available regions]
    C --> E[Check quotas and pricing]
    D --> E
    E --> F[Select optimal region]
    F --> G[Create instance in region]
```

### Resource Allocation

```mermaid
graph TB
    subgraph "Resource Request"
        RR[Job Resource Request<br/>CPU, Memory, Storage]
    end
    
    subgraph "Resource Matching"
        RM[Resource Manager]
        ICM[Instance Collection Manager]
    end
    
    subgraph "Instance Selection"
        IS[Instance Selection<br/>Pool or Job Private]
    end
    
    RR --> RM
    RM --> ICM
    ICM --> IS
    
    IS -->|Pool| P[Pool Instance]
    IS -->|Job Private| JP[New Job Private Instance]
```

## Instance Lifecycle

### State Transitions

```mermaid
stateDiagram-v2
    [*] --> Pending: Create instance
    Pending --> Active: Worker activates
    Active --> Inactive: Worker deactivates
    Inactive --> Deleted: Cleanup
    Active --> Deleted: Force delete
    Pending --> Deleted: Creation failed
    
    note right of Active
        - Accepting jobs
        - Running containers
        - Reporting status
    end note
    
    note right of Inactive
        - No active jobs
        - Idle timeout
        - Ready for cleanup
    end note
```

### Monitoring and Health Checks

The batch driver continuously monitors instance health:

- **Heartbeat monitoring**: Workers report status every minute
- **Failed request tracking**: Instances with repeated failures are marked unhealthy
- **Automatic cleanup**: Inactive instances are automatically deleted
- **Preemption handling**: Preempted instances are detected and jobs rescheduled

## Configuration

### Instance Collection Configuration

```yaml
# Example pool configuration
pools:
  standard:
    worker_type: "standard"
    worker_cores: 16
    preemptible: true
    max_instances: 1000
    max_live_instances: 500
    worker_max_idle_time_secs: 300
    autoscaler_loop_period_secs: 15
    max_new_instances_per_autoscaler_loop: 10
```

### Cloud-Specific Configuration

Each cloud provider has specific configuration requirements:

- **GCP**: Project, zones, machine types, service accounts
- **Azure**: Subscription, resource groups, regions, service principals  
- **Terra**: Workspace configuration, resource IDs

## Scaling and Autoscaling

### Autoscaler Logic

```mermaid
graph TD
    A[Autoscaler Loop<br/>Every 15 seconds] --> B[Calculate fair share]
    B --> C[Estimate required cores]
    C --> D[Check current capacity]
    D --> E{Need more instances?}
    E -->|Yes| F[Create instances<br/>Respect rate limits]
    E -->|No| G[Wait for next cycle]
    F --> G
    G --> A
```

### Fair Share Algorithm

The autoscaler uses a fair share algorithm to prevent resource starvation:

1. Sort users by current running cores (ascending)
2. Allocate cores to users with fewest running cores first
3. Distribute remaining cores equally among users
4. Scale up instances based on fair share allocation

## Troubleshooting

### Common Issues

1. **Instance Creation Failures**
   - Cloud provider quotas exceeded
   - Invalid machine type or region
   - Network configuration issues

2. **Worker Activation Failures**
   - Startup script errors
   - Docker image pull failures
   - Network connectivity issues

3. **Resource Allocation Issues**
   - Insufficient capacity in desired regions
   - Job requirements exceed available instance types
   - Fair share algorithm bottlenecks

### Debugging Tools

- **Batch Driver UI**: Real-time view of instance states and statistics
- **Worker Logs**: Detailed logs from worker VMs
- **Cloud Provider Logs**: VM creation and management logs
- **Database Queries**: Instance and job state tracking 