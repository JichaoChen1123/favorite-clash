"""Manual training records, independent of model inference and video jobs."""
from typing import Literal
from uuid import UUID, uuid4

from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, model_validator

from .store import TrainingConflict, now


class Input(BaseModel):
    model_config = ConfigDict(extra='forbid')


class TrainingSet(Input):
    id: str = Field(pattern=r'^[a-zA-Z0-9-]{1,64}$')
    weight_kg: float | None = Field(default=None, strict=True, ge=0, le=2000, allow_inf_nan=False)
    reps: int | None = Field(default=None, strict=True, ge=1, le=1000)
    completed: bool = Field(strict=True)

    @model_validator(mode='after')
    def completed_values(self):
        if self.completed and (self.weight_kg is None or self.reps is None):
            raise ValueError('完成的一组需要重量和次数；徒手重量填0。')
        return self


class TrainingExercise(Input):
    exercise_id: str = Field(min_length=1, max_length=100)
    sets: list[TrainingSet] = Field(min_length=1, max_length=20)

    @model_validator(mode='after')
    def unique_sets(self):
        if len({s.id for s in self.sets}) != len(self.sets):
            raise ValueError('同一动作的组编号不能重复。')
        return self


class CreateTraining(Input):
    id: UUID
    exercise_ids: list[str] = Field(min_length=1, max_length=30)


class UpdateTraining(Input):
    version: int = Field(strict=True, ge=1)
    status: Literal['active','completed','cancelled']
    exercises: list[TrainingExercise] = Field(min_length=1, max_length=30)


def install_training_routes(app: FastAPI, catalog: dict):
    items = {x['id']: x for x in catalog['items']}

    def check_ids(ids):
        if len(ids) != len(set(ids)):
            raise HTTPException(422, '同一次训练不能重复添加相同动作。')
        if not set(ids) <= items.keys():
            raise HTTPException(422, '有动作尚未收录，请刷新动作库后选择。')

    def snapshot(ident, sets):
        item = items[ident]
        return {'exercise_id': ident, 'name': item['name'], 'equipment': item['equipment'], 'sets': sets}

    @app.get('/api/training')
    async def overview(request: Request):
        return request.app.state.store.training_overview()

    @app.get('/api/training/{ident}')
    async def get_training(ident: UUID, request: Request):
        document = request.app.state.store.training_get(str(ident))
        if not document:
            raise HTTPException(404, '这次训练不存在。')
        return document

    @app.post('/api/training', status_code=201)
    async def create_training(payload: CreateTraining, request: Request):
        check_ids(payload.exercise_ids)
        stamp = now()
        document = {'id': str(payload.id), 'created_at': stamp, 'updated_at': stamp, 'ended_at': None,
                    'status': 'active', 'version': 1,
                    'exercises': [snapshot(ident, [{'id': uuid4().hex, 'weight_kg': None, 'reps': None, 'completed': False} for _ in range(3)]) for ident in payload.exercise_ids]}
        try:
            return request.app.state.store.training_create(document)
        except TrainingConflict as exc:
            raise HTTPException(409, str(exc)) from exc

    @app.put('/api/training/{ident}')
    async def update_training(ident: UUID, payload: UpdateTraining, request: Request):
        check_ids([x.exercise_id for x in payload.exercises])
        if payload.status == 'completed' and not any(s.completed for x in payload.exercises for s in x.sets):
            raise HTTPException(422, '请先记录至少一组完成的训练，再结束保存。')
        exercises = [snapshot(x.exercise_id, [s.model_dump() for s in x.sets]) for x in payload.exercises]
        try:
            document = request.app.state.store.training_update(str(ident), payload.version, payload.status, exercises)
        except TrainingConflict as exc:
            raise HTTPException(409, str(exc)) from exc
        if not document:
            raise HTTPException(404, '这次训练不存在。')
        return document
