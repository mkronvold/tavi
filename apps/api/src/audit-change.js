"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toAuditChangeValue = toAuditChangeValue;
exports.buildAuditChanges = buildAuditChanges;
function toAuditChangeValue(value) {
    if (value instanceof Date) {
        return value.toISOString();
    }
    return value ?? null;
}
function buildAuditChanges(changedFields, previous, next) {
    return changedFields.map((field) => ({
        field,
        from: previous[field] ?? null,
        to: next[field] ?? null,
    }));
}
