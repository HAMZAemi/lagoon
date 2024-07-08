import * as R from 'ramda';
import { Pool } from 'mariadb';
import { asyncPipe } from '@lagoon/commons/dist/util/func';
import { query } from '../../util/db';
import { Sql } from './sql';
import { Sql as problemSql } from '../problem/sql';
import { Sql as factSql } from '../fact/sql';
import { Helpers as projectHelpers } from '../project/helpers';
import { HistoryRetentionEnforcer } from '../retentionpolicy/history';
import { logger } from '../../loggers/logger';

export const Helpers = (sqlClientPool: Pool) => {
  const aliasOpenshiftToK8s = (environments: any[]) => {
    return environments.map(environment => {
      return {
        ...environment,
        kubernetesNamespaceName: environment.openshiftProjectName
      };
    });
  };

  const getEnvironmentById = async (environmentID: number) => {
    const rows = await query(
      sqlClientPool,
      Sql.selectEnvironmentById(environmentID)
    );
    const withK8s = aliasOpenshiftToK8s(rows);
    return R.prop(0, withK8s);
  };

  return {
    aliasOpenshiftToK8s,
    getEnvironmentById,
    deleteEnvironment: async (name: string, eid: number, pid: number) => {
      const environmentData = await Helpers(sqlClientPool).getEnvironmentById(eid);
      const projectData = await projectHelpers(sqlClientPool).getProjectById(pid);
      try {
        // clean up environment variables
        // logger.debug(`deleting environment ${name}/id:${eid}/project:${pid} environment variables`)
        await query(
          sqlClientPool,
          Sql.deleteEnvironmentVariables(eid)
        );
        // clean up service containers
        // logger.debug(`deleting environment ${name}/id:${eid}/project:${pid} environment service containers`)
        await query(
          sqlClientPool,
          Sql.deleteServiceContainersByEnvironmentId(
            eid
          )
        );
        // clean up services
        // logger.debug(`deleting environment ${name}/id:${eid}/project:${pid} environment services`)
        await query(
          sqlClientPool,
          Sql.deleteServices(eid)
        );
        // Here we clean up insights attached to the environment
        // logger.debug(`deleting environment ${name}/id:${eid}/project:${pid} environment facts`)
        await query(
          sqlClientPool,
          factSql.deleteFactsForEnvironment(eid)
        );
        // logger.debug(`deleting environment ${name}/id:${eid}/project:${pid} environment problems`)
        await query(
          sqlClientPool,
          problemSql.deleteProblemsForEnvironment(eid)
        );

        // @TODO: environment_storage, environment_backup
      } catch (e) {
        logger.error(`error cleaning up linked environment tables: ${e}`)
      }

      try {
        // export a dump of the project, environment data, and associated task and deployment history before the environment is deleted
        await HistoryRetentionEnforcer().saveEnvironmentHistoryBeforeDeletion(projectData, environmentData)
      } catch (e) {
        logger.error(`error running save environment history: ${e}`)
      }
      // purge all history for this environment, including logs and files from s3
      try {
        // remove all deployments and associated files
        await HistoryRetentionEnforcer().cleanupAllDeployments(projectData, environmentData)
      } catch (e) {
        logger.error(`error running deployment retention enforcer: ${e}`)
      }
      try {
        // remove all tasks and associated files
        await HistoryRetentionEnforcer().cleanupAllTasks(projectData, environmentData)
      } catch (e) {
        logger.error(`error running task retention enforcer: ${e}`)
      }
      // delete the environment
      // logger.debug(`deleting environment ${name}/id:${eid}/project:${pid}`)
      await query(
        sqlClientPool,
        Sql.deleteEnvironment(name, pid)
      );

    },
    getEnvironmentsDeploytarget: async (eid) => {
      const rows = await query(
        sqlClientPool,
        Sql.selectDeployTarget(eid)
      );
      return aliasOpenshiftToK8s(rows);
    },
    getEnvironmentsByProjectId: async (projectId) => {
      const rows = await query(
        sqlClientPool,
        Sql.selectEnvironmentsByProjectID(projectId)
      );
      return aliasOpenshiftToK8s(rows);
    },
    getEnvironmentByNameAndProject: async (environmentName, projectId) => {
      const rows = await query(
        sqlClientPool,
        Sql.selectEnvironmentByNameAndProject(
          environmentName,
          projectId
        )
      );
      if (!R.prop(0, rows)) {
        throw new Error('Unauthorized');
      }

      return rows;
    },
    getEnvironmentsByEnvironmentInput: async environmentInput => {
      const notEmpty = R.complement(R.anyPass([R.isNil, R.isEmpty]));
      const hasId = R.both(R.has('id'), R.propSatisfies(notEmpty, 'id'));
      const hasName = R.both(R.has('name'), R.propSatisfies(notEmpty, 'name'));
      const hasProject = R.both(
        R.has('project'),
        R.propSatisfies(notEmpty, 'project')
      );
      // @ts-ignore
      const hasNameAndProject = R.both(hasName, hasProject);

      const envFromId = asyncPipe(
        R.prop('id'),
        getEnvironmentById,
        environment => {
          if (!environment) {
            throw new Error('Unauthorized');
          }

          return [environment];
        }
      );

      const envFromNameProject = async input => {
        const project = await projectHelpers(
          sqlClientPool
        ).getProjectByProjectInput(R.prop('project', input));
        const rows = await query(
          sqlClientPool,
          Sql.selectEnvironmentByNameAndProject(
            R.prop('name', input),
            project.id
          )
        );

        if (!R.prop(0, rows)) {
          throw new Error('Unauthorized');
        }

        return rows;
      };

      return R.cond([
        [hasId, envFromId],
        // @ts-ignore
        [hasNameAndProject, envFromNameProject],
        [
          R.T,
          () => {
            throw new Error(
              'Must provide environment (id) or (name and project)'
            );
          }
        ]
      // @ts-ignore
      ])(environmentInput);
    },
    getEnvironmentServices: async (eid: number) => {
      const rows = await query(
        sqlClientPool,
        Sql.selectServicesByEnvironmentId(
          eid
        )
      );
      return rows;
    },
    resetServiceContainers: async (serviceId: number, containers: any) => {
      await query(
        sqlClientPool,
        Sql.deleteServiceContainers(serviceId)
      );
      for (const container of containers){
        await query(
          sqlClientPool,
          Sql.insertServiceContainer(serviceId, container.name)
        );
      }
    },
  };
};
