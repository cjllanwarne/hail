-- One row per flaky declaration (covers the whole batch)
CREATE TABLE flaky_batch_declarations (
  id         BIGINT NOT NULL AUTO_INCREMENT,
  batch_id   BIGINT NOT NULL,
  action     ENUM('retry', 'ignore') NOT NULL,
  declared_by VARCHAR(100) NOT NULL,
  declared_at TIMESTAMP NOT NULL DEFAULT (UTC_TIMESTAMP),
  pr_number  INT,
  source_sha VARCHAR(100),
  PRIMARY KEY (id),
  INDEX (batch_id),
  INDEX (declared_at)
) ENGINE = InnoDB;

-- One row per failed job within a declaration
CREATE TABLE flaky_job_declarations (
  id             BIGINT NOT NULL AUTO_INCREMENT,
  declaration_id BIGINT NOT NULL,
  job_id         INT NOT NULL,
  job_name       VARCHAR(500) NOT NULL,
  PRIMARY KEY (id),
  INDEX (declaration_id),
  INDEX (job_name),
  FOREIGN KEY (declaration_id) REFERENCES flaky_batch_declarations(id) ON DELETE CASCADE
) ENGINE = InnoDB;
