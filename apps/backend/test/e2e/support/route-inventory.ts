import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { ModulesContainer, Reflector } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { IS_PUBLIC_KEY } from '../../../src/common/decorators/public.decorator';
import { ROLES_KEY } from '../../../src/common/decorators/roles.decorator';
import { ANY_PERMISSIONS_KEY, REQUIRED_PERMISSIONS_KEY } from '../../../src/modules/permissions/decorators/requires-permission.decorator';
import { RolesGuard } from '../../../src/common/guards/roles.guard';

export type Rule = 'PUBLIC' | 'PERMISSION' | 'ROLES' | 'AUTHENTICATED' | 'BROKEN_ROLES_WITHOUT_GUARD';
export interface RouteRow {
  /** "VERB /path/:param" */
  route: string;
  verb: string;
  path: string;
  controller: string;
  rule: Rule;
  roles: string[];
  permissions: string[];
}

const join = (...parts: Array<string | undefined>) => '/' + parts.filter(Boolean).join('/').replace(/\/+/g, '/').replace(/^\/|\/$/g, '');

/**
 * Every route of the REAL, fully wired application with the access rule that is actually ENFORCED (read from the same metadata the
 * global guards read): PUBLIC (@Public), PERMISSION (@RequiresPermission, PermissionsGuard is global), ROLES (@Roles AND RolesGuard
 * applied), AUTHENTICATED (any valid token), or BROKEN_ROLES_WITHOUT_GUARD (@Roles with no RolesGuard — enforces nothing).
 */
export function scanRoutes(app: NestExpressApplication): RouteRow[] {
  const rows: RouteRow[] = [];
  const reflector = app.get(Reflector);
  const modules = app.get(ModulesContainer);
  for (const module of modules.values()) {
    for (const wrapper of module.controllers.values()) {
      const metatype = wrapper.metatype as any;
      if (!metatype) continue;
      const prefix = Reflect.getMetadata(PATH_METADATA, metatype);
      const prefixPath = Array.isArray(prefix) ? prefix[0] : prefix;
      const proto = metatype.prototype;
      for (const name of Object.getOwnPropertyNames(proto)) {
        const handler = proto[name];
        if (name === 'constructor' || typeof handler !== 'function') continue;
        const method = Reflect.getMetadata(METHOD_METADATA, handler);
        if (method === undefined) continue;
        const subPath = Reflect.getMetadata(PATH_METADATA, handler);
        const verb = RequestMethod[method];
        const isPublic = !!reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [handler, metatype]);
        // ALL-of (@RequiresPermission) plus ANY-of (@RequiresAnyPermission): both are enforced by the global PermissionsGuard.
        const permissions = [...(reflector.getAllAndOverride<string[]>(REQUIRED_PERMISSIONS_KEY, [handler, metatype]) ?? []), ...(reflector.getAllAndOverride<string[]>(ANY_PERMISSIONS_KEY, [handler, metatype]) ?? [])];
        const roles = reflector.getAllAndOverride<string[]>(ROLES_KEY, [handler, metatype]) ?? [];
        const guards: unknown[] = [...(Reflect.getMetadata(GUARDS_METADATA, metatype) ?? []), ...(Reflect.getMetadata(GUARDS_METADATA, handler) ?? [])];
        const hasRolesGuard = guards.includes(RolesGuard);
        let rule: Rule;
        if (isPublic) rule = 'PUBLIC';
        else if (permissions.length > 0) rule = 'PERMISSION';
        else if (roles.length > 0 && hasRolesGuard) rule = 'ROLES';
        else if (roles.length > 0) rule = 'BROKEN_ROLES_WITHOUT_GUARD';
        else rule = 'AUTHENTICATED';
        const path = join(prefixPath, Array.isArray(subPath) ? subPath[0] : subPath);
        rows.push({ route: `${verb} ${path}`, verb, path, controller: metatype.name, rule, roles, permissions });
      }
    }
  }
  return rows;
}
