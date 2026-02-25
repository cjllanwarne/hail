CREATE TABLE authorized_shas (
  sha VARCHAR(100) NOT NULL
) ENGINE = InnoDB;

CREATE INDEX authorized_shas_sha ON authorized_shas (sha);

CREATE TABLE alerted_failed_shas (
  sha VARCHAR(100) NOT NULL,
  PRIMARY KEY (`sha`)
) ENGINE = InnoDB;

CREATE TABLE invalidated_batches (
  batch_id BIGINT NOT NULL
) ENGINE = InnoDB;

CREATE INDEX invalidated_batches_batch_id ON invalidated_batches (batch_id);

CREATE TABLE IF NOT EXISTS `globals` (
  `frozen_merge_deploy` BOOLEAN NOT NULL DEFAULT FALSE
) ENGINE = InnoDB;

INSERT INTO `globals` (frozen_merge_deploy) VALUES (FALSE);

CREATE TABLE IF NOT EXISTS `active_namespaces` (
  `namespace` VARCHAR(100) NOT NULL,
  `creation_time` TIMESTAMP NOT NULL DEFAULT (UTC_TIMESTAMP),
  `expiration_time` TIMESTAMP,
  PRIMARY KEY (`namespace`)
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS `deployed_services` (
  `namespace` VARCHAR(100) NOT NULL,
  `service` VARCHAR(100) NOT NULL,
  `rate_limit_rps` INT,
  PRIMARY KEY (`namespace`, `service`),
  FOREIGN KEY (`namespace`) REFERENCES active_namespaces(namespace) ON DELETE CASCADE
) ENGINE = InnoDB;

INSERT INTO `active_namespaces` (`namespace`) VALUES (`default`);
INSERT INTO `deployed_services` (`namespace`, `service`) VALUES
('default', 'auth'), ('default', 'batch'), ('default', 'batch-driver'), ('default', 'ci');

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
