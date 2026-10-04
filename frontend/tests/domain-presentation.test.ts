import '@angular/compiler';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HttpErrorResponse } from '@angular/common/http';
import { qualityLabel, qualityValue } from '../src/app/core/quality-presentation';
import { operationLabel, occurrenceLabel } from '../src/app/core/presentation';
import { apiError } from '../src/app/core/api';
test('quality presentation translates known fields and formats dates without inventing measurements', () => {
  assert.equal(qualityLabel('baseline'), 'Pacote histórico instalado');
  assert.equal(qualityValue({catalog_links_checked: false}), 'Vínculos com os catálogos conferidos: Não');
  assert.equal(qualityValue('2026-10-03T15:24:01Z', 'imported_at'), '03/10/2026, 12:24');
  assert.equal(qualityValue('2026-10-03', 'first_date'), '03/10/2026');
  assert.equal(qualityValue(null), 'Não disponível');
  assert.equal(qualityValue({}, 'issues'), 'Nenhuma pendência registrada');
  assert.equal(qualityLabel('unknown_db_field'), 'Informação adicional');
  assert.equal(qualityValue({unknown_db_field: 1}), 'Consulte os detalhes técnicos');
});
test('operation and exceptional-rule labels name the actual domain state', () => {
  assert.equal(operationLabel('completed'), 'Descarga concluída');
  assert.equal(occurrenceLabel('EARLY_LEAVE'), 'Saída antecipada');
  assert.equal(operationLabel('unknown'), 'Estado não reconhecido');
});
test('validation errors preserve the server explanation and translate field keys', () => {
  const error = new HttpErrorResponse({status:400,error:{error:{details:{invoice_ids:['As notas devem pertencer ao fornecedor.'],expected_revision:['Recarregue o registro.']}}}});
  assert.equal(apiError(error), 'Notas fiscais: As notas devem pertencer ao fornecedor. · Versão do recebimento: Recarregue o registro.');
});
